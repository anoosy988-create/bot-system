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
    aiChatChannelId: { type: String, default: null },
    aiCodeChannelId: { type: String, default: null },
    jailRoles: {
        type: Map,
        of: [String],
        default: new Map()
    }
});

const GuildSettings = mongoose.model('GuildSettings', guildSchema);

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

// ==================== AI CODE GENERATION (multi-provider) ====================
// يحتاج متغيرات بيئة: ANTHROPIC_API_KEY (أساسي)، OPENAI_API_KEY و DEEPSEEK_API_KEY (اختياريين للاحتياط)
// يحتاج Node 18+ عشان fetch مدمج بدون مكتبات إضافية
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const CODE_SYSTEM_PROMPT = 'أنت مبرمج خبير. لما يطلب منك المستخدم أداة أو كود، اكتب الكود كامل وجاهز للتشغيل داخل بلوك كود واحد فقط بالشكل ```language ... ```، مع تعليقات مختصرة داخل الكود توضح كل جزء. لا تكتب شرح طويل خارج بلوك الكود.';

async function generateCodeWithClaude(userPrompt, systemPrompt) {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY غير موجود');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        })
    });

    if (!response.ok) throw new Error(`Claude API error (${response.status}): ${await response.text()}`);

    const data = await response.json();
    const textBlock = data.content.find(b => b.type === 'text');
    return textBlock ? textBlock.text : '';
}

async function generateCodeWithOpenAI(userPrompt, systemPrompt) {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY غير موجود');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 4096,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        })
    });

    if (!response.ok) throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`);

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

async function generateCodeWithDeepSeek(userPrompt, systemPrompt) {
    if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY غير موجود');

    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            max_tokens: 4096,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        })
    });

    if (!response.ok) throw new Error(`DeepSeek API error (${response.status}): ${await response.text()}`);

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

// يجرب المزودين بالترتيب: Claude أولاً، ثم OpenAI، ثم DeepSeek — أول وحد ينجح يوقف عنده
// نفس الدالة تستخدم لتوليد الكود (اصنع) وللسوالف العامة (منشن البوت)، بس systemPrompt يتغير حسب الاستخدام
async function generateAIResponse(userPrompt, systemPrompt) {
    const providers = [
        { name: 'Claude', fn: generateCodeWithClaude },
        { name: 'OpenAI', fn: generateCodeWithOpenAI },
        { name: 'DeepSeek', fn: generateCodeWithDeepSeek }
    ];

    const errors = [];
    for (const provider of providers) {
        try {
            const result = await provider.fn(userPrompt, systemPrompt);
            if (result && result.trim()) return { text: result, usedProvider: provider.name };
        } catch (e) {
            errors.push(`${provider.name}: ${e.message}`);
        }
    }

    throw new Error('كل المزودين فشلوا:\n' + errors.join('\n'));
}

// شخصية السوالف العامة (لما حد يمنشن البوت)
const CHAT_SYSTEM_PROMPT = 'انت بوت ديسكورد ودود وذكي، تسولف مع أعضاء السيرفر باللهجة العربية العامية بشكل طبيعي وعفوي، مو رسمي. ردودك قصيرة ومباشرة (كم سطر بس) إلا إذا الشخص طلب تفصيل أكثر أو شرح تقني. لو سألوك عن كود أو برمجة قدر تساعد، بس خل الرد المباشر مختصر ووجّههم لأمر `اصنع` لو يبون ملف كود كامل.';

// يحاول يستخرج الكود من داخل ```language ... ``` ويحدد امتداد الملف حسب اللغة
function extractCodeAndExtension(aiText) {
    const codeBlockMatch = aiText.match(/```(\w+)?\n([\s\S]*?)```/);

    const langToExt = {
        javascript: 'js', js: 'js', node: 'js',
        typescript: 'ts', ts: 'ts',
        python: 'py', py: 'py',
        html: 'html', css: 'css', json: 'json',
        bash: 'sh', sh: 'sh', shell: 'sh',
        batch: 'bat', bat: 'bat', cmd: 'bat',
        java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', php: 'php'
    };

    if (codeBlockMatch) {
        const lang = (codeBlockMatch[1] || '').toLowerCase();
        const code = codeBlockMatch[2].trim();
        const ext = langToExt[lang] || 'txt';
        return { code, ext };
    }

    // ما فيه بلوك كود واضح، نحفظ الرد كامل كملف نصي
    return { code: aiText.trim(), ext: 'txt' };
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

// شبكة أمان: أي خطأ غير متوقع بأي مكان بالكود يتسجل بس، ما يطيّح البوت كامل
process.on('unhandledRejection', (error) => {
    console.error('[UNHANDLED REJECTION]', error);
});

// ==================== ANTI-DUPLICATE ====================
const processedMessages = new Set();

// ==================== COMMANDS LIST ====================
const PREFIX_COMMANDS = [
    'مساعده', 'help',
    'سجن', 'تميم.مابيك', 'افراج',
    'تف', 'تميم.يسلم.عليك', 'بزبي',
    'طرد', 'kick',
    'تكلم', 'تميم.يقولك.تكلم',
    'r', 'شيل',
    'سد حلقك', 'تايم', 'تميم.يقولك.اسكت',
    'فك', 'تميم.يبيك.ترجع',
    'مسح',
    'اصنع',
    'ق', 'ف'
];

// ==================== SLASH COMMANDS ====================
client.on('ready', async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // نشيل index قديم اسمه guild_id_1 لو موجود (باقي من نسخة سابقة للسكيما)
        // كان يسبب E11000 duplicate key error لأنه يفرض uniqueness على حقل مالنا فيه
        try {
            await GuildSettings.collection.dropIndex('guild_id_1');
            console.log('🧹 تم حذف index القديم guild_id_1');
        } catch (e) {
            // طبيعي لو الـ index مو موجود أصلاً (بعد أول مرة تشتغل)
        }
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
            .setName('setchat')
            .setDescription('تحديد روم السوالف مع الذكاء الاصطناعي (أدمن بس)')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('اختر الروم')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('setcode')
            .setDescription('تحديد روم صناعة الأكواد (معالي المطيري بس)')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('اختر الروم')
                    .setRequired(true)
            )
    ];

    await client.application.commands.set(commands);
    console.log('✅ Slash commands registered');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
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

        if (interaction.commandName === 'setchat') {
            if (!isOwner(interaction.user.id) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel');

            await GuildSettings.findByIdAndUpdate(
                interaction.guild.id,
                { aiChatChannelId: channel.id },
                { upsert: true, new: true }
            );

            return interaction.reply({ content: `✅ تم تحديد روم السوالف: ${channel}`, ephemeral: true });
        }

        if (interaction.commandName === 'setcode') {
            // مقفول على معالي المطيري بس — بدون أي استثناء
            if (!isOwner(interaction.user.id)) {
                return interaction.reply({ content: 'معالي المطيري ماتقدر تسوي له شي', ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel');

            await GuildSettings.findByIdAndUpdate(
                interaction.guild.id,
                { aiCodeChannelId: channel.id },
                { upsert: true, new: true }
            );

            return interaction.reply({ content: `✅ تم تحديد روم صناعة الأكواد: ${channel}`, ephemeral: true });
        }
    } catch (error) {
        // أهم سطر بهذا التعديل: أي خطأ هنا يتسجل بس ما يطيّح البوت كامل زي ما صار قبل
        console.error('[SLASH COMMAND ERROR]', error);
        const errorReply = { content: `❌ صار خطأ: \`${error.message}\``, ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorReply).catch(() => {});
        } else {
            await interaction.reply(errorReply).catch(() => {});
        }
    }
});

// ==================== WELCOME EVENT ====================
client.on('guildMemberAdd', async (member) => {
    try {
        const settings = await GuildSettings.findById(member.guild.id).lean();
        if (!settings || !settings.welcomeChannelId) return;

        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (!channel) return;

        const memberCount = member.guild.memberCount;

        const messageContent = `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𓇻 • 𝟏𝟗𝟗𝟒 𝐅𝐀𝐌𝐈𝐋𝐘\n\n〢𝐌𝐄𝐌𝐁𝐄𝐑 : <@${member.id}>\n\n〢𝐂𝐇𝐀𝐓 : <#1541459798468464710>\n\n〢𝐑𝐔𝐋𝐄𝐒 : <#1459481940884459583>\n\n〢𝐍𝐔𝐌𝐁𝐄𝐑 : ${memberCount}\n\n〢𝐈𝐍𝐕𝐈𝐓𝐄𝐑 : <@${member.id}>`;

        await channel.send({ content: messageContent });
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

    // ==================== سوالف عامة (أي رسالة داخل روم السوالف) — متاح للكل ====================
    const aiSettings = await GuildSettings.findById(message.guild.id).lean();

    if (aiSettings && aiSettings.aiChatChannelId && message.channel.id === aiSettings.aiChatChannelId) {
        const chatPrompt = message.content
            .replace(/<@!?\d+>/g, '')
            .trim();

        if (chatPrompt) {
            try {
                const { text } = await generateAIResponse(chatPrompt, CHAT_SYSTEM_PROMPT);
                // ديسكورد ما يقبل رسالة أطول من 2000 حرف
                const trimmed = text.length > 1900 ? text.slice(0, 1900) + '...' : text;
                await message.reply(trimmed);
            } catch (error) {
                console.error('[AI CHAT ERROR]', error);
                await message.reply('❌ ما قدرت أرد عليك الحين، جرب بعدين.');
            }
        }
        return; // ما نكمل لأوامر ثانية داخل روم السوالف
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
                    { name: 'الرسايل', value: '`مسح <عدد>` - حذف رسايل (أقصى 100)\n`ق` - قفل الروم\n`ف` - فتح الروم', inline: true },
                    { name: 'الذكاء الاصطناعي', value: '`اصنع <وصف>` - يولد كود ويرسله كملف (أونر بس)\nمنشن البوت + سؤال = يسولف معك', inline: true },
                    { name: 'الإعدادات', value: '`/setlog` - تحديد روم اللوقات\n`/setwelcome` - تحديد روم الترحيب\n`/setchat` - تحديد روم السوالف (أدمن بس)\n`/setcode` - تحديد روم صناعة الأكواد (معالي المطيري بس)', inline: true }
                )
                .setFooter({ text: 'البوت يعمل بكفاءة' })
                .setTimestamp();
            return message.channel.send({ embeds: [embed] });
        }

        if (commandName === 'سجن' || commandName === 'تميم.مابيك') {
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

            // لا نستخدم lean() هنا لأن jailRoles من نوع Map، و lean() يحوّله لـ Object عادي بدون دالة get()
            const settings = await GuildSettings.findById(message.guild.id);
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
            await sendLog(message.guild, '🔓 فك حظر', { id: userId, username: username }, `بواسطة: ${message.author.username}`, 0x00FF00);
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

            // ديسكورد ما يسمح بتايم أوت أطول من 28 يوم
            const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;
            if (duration > MAX_TIMEOUT) {
                return message.reply('❌ أقصى مدة مسموحة هي 28 يوم.');
            }

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

        if (commandName === 'مسح') {
            // ما نحتاج target هنا لأن الأمر يشتغل على الروم كامل، مو على عضو
            const check = canExecute(message, null, PermissionsBitField.Flags.ManageMessages);
            if (!check.allowed) return message.reply(check.reason);

            const amount = parseInt(args[0]);

            if (isNaN(amount)) {
                return message.reply('❌ حدد عدد صحيح. مثال: `مسح 20`');
            }

            if (amount < 1 || amount > 100) {
                return message.reply('❌ العدد لازم يكون بين 1 و 100.');
            }

            try {
                // true = يتجاهل بصمت الرسايل الأقدم من 14 يوم بدل ما يرمي خطأ
                const deleted = await message.channel.bulkDelete(amount, true);

                const confirmMsg = await message.channel.send(`🗑️ تم مسح **${deleted.size}** رسالة بواسطة ${message.author.username}.`);
                setTimeout(() => confirmMsg.delete().catch(() => {}), 3000);

                await sendLog(message.guild, '🗑️ مسح رسايل', message.author, `العدد: ${deleted.size} | في روم: <#${message.channel.id}>`, 0xFFA500);
            } catch (error) {
                console.error('[MESSAGE PURGE ERROR]', error);
                return message.reply('❌ صار خطأ أثناء الحذف. تأكد إن الرسايل أقل من 14 يوم أو إن البوت عنده صلاحية Manage Messages.');
            }
        }

        if (commandName === 'ق') {
            // قفل الروم: يمنع @everyone من الكتابة. تقدر تمنشن روم ثاني، وإلا يقفل نفس الروم الحالي
            const check = canExecute(message, null, PermissionsBitField.Flags.ManageChannels);
            if (!check.allowed) return message.reply(check.reason);

            const mentionedChannel = message.mentions.channels.first();
            const targetChannel = mentionedChannel || message.channel;

            try {
                await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    SendMessages: false
                });
                await sendLog(message.guild, '🔒 قفل روم', message.author, `الروم: <#${targetChannel.id}> | بواسطة: ${message.author.username}`, 0xFF0000);
                return message.reply(`🔒 تم قفل <#${targetChannel.id}>.`);
            } catch (error) {
                console.error('[LOCK CHANNEL ERROR]', error);
                return message.reply('❌ ما قدرت أقفل الروم. تأكد إن عندي صلاحية Manage Channels.');
            }
        }

        if (commandName === 'ف') {
            // فتح الروم: يرجع للأعضاء صلاحية الكتابة. تقدر تمنشن روم ثاني، وإلا يفتح نفس الروم الحالي
            const check = canExecute(message, null, PermissionsBitField.Flags.ManageChannels);
            if (!check.allowed) return message.reply(check.reason);

            const mentionedChannel = message.mentions.channels.first();
            const targetChannel = mentionedChannel || message.channel;

            try {
                await targetChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
                    SendMessages: true
                });
                await sendLog(message.guild, '🔓 فتح روم', message.author, `الروم: <#${targetChannel.id}> | بواسطة: ${message.author.username}`, 0x00FF00);
                return message.reply(`🔓 تم فتح <#${targetChannel.id}>.`);
            } catch (error) {
                console.error('[UNLOCK CHANNEL ERROR]', error);
                return message.reply('❌ ما قدرت أفتح الروم. تأكد إن عندي صلاحية Manage Channels.');
            }
        }

        if (commandName === 'اصنع') {
            // مقفول على معالي المطيري بس
            if (!isOwner(message.author.id)) {
                return message.reply('معالي المطيري ماتقدر تسوي له شي');
            }

            // نفس قيد روم صناعة الأكواد المحدد بـ /setcode
            const aiSettings = await GuildSettings.findById(message.guild.id).lean();
            if (!aiSettings || !aiSettings.aiCodeChannelId) {
                return message.reply('⚠️ ما حددت روم صناعة الأكواد بعد. استخدم `/setcode` وحدد الروم أول.');
            }
            if (message.channel.id !== aiSettings.aiCodeChannelId) {
                return message.reply(`❌ هذا الأمر يشتغل بس في <#${aiSettings.aiCodeChannelId}>.`);
            }

            const userPrompt = args.join(' ').trim();
            if (!userPrompt) {
                return message.reply('❌ اكتب وش تبي تصنع. مثال: `اصنع اداة نسخ سيرفرات بـ node.js discord.js`');
            }

            const thinkingMsg = await message.reply('🧠 جاري توليد الكود، ثواني...');

            try {
                const { text: aiText, usedProvider } = await generateAIResponse(userPrompt, CODE_SYSTEM_PROMPT);
                const { code, ext } = extractCodeAndExtension(aiText);

                const fileName = `generated_${Date.now()}.${ext}`;
                fs.writeFileSync(fileName, code);

                await message.channel.send({
                    content: `✅ تفضل الكود (تم توليده عبر ${usedProvider}):`,
                    files: [{ attachment: fileName, name: fileName }]
                });

                fs.unlinkSync(fileName);
                await thinkingMsg.delete().catch(() => {});
            } catch (error) {
                console.error('[AI GEN ERROR]', error);
                await thinkingMsg.edit(`❌ صار خطأ أثناء توليد الكود: ${error.message}`).catch(() => {});
            }
        }

    } catch (error) {
        console.error(`[ERROR] في أمر "${commandName}":`, error);
        message.reply(`❌ صار خطأ: \`${error.message}\``).catch(() => {});
    }
});

client.login(process.env.TOKEN).catch(err => {
    console.error('❌ خطأ في تسجيل الدخول:', err);
});
