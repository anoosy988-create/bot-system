const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder, 
    PermissionFlagsBits, 
    MessageFlags,
    AttachmentBuilder,
    AuditLogEvent
} = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// ==========================================
// 1. سيرفر الويب لمنصة Render (المنفذ وتفادي الإيقاف)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('🤖 Bot status: Online & Ready!'));
app.listen(PORT, () => console.log(`🌐 [SERVER] السيرفر يعمل على المنفذ ${PORT}`));

// ==========================================
// 2. الاتصال بقاعدة البيانات MongoDB
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ [DATABASE] تم الاتصال بقاعدة بيانات MongoDB بنجاح!'))
    .catch(err => console.error('❌ [DATABASE] خطأ في الاتصال بقاعدة البيانات:', err));

// ==========================================
// 3. قواعد البيانات (Mongoose Schemas)
// ==========================================

// إعدادات السيرفر العامة
const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    logChannelId: String,
    welcomeChannelId: String,
    autoRoleId: String,
    jailRoleId: String
});
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);

// بيانات السجن (تخزين رتب العضو المسجون)
const jailSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    oldRoles: [String]
});
const JailData = mongoose.model('JailData', jailSchema);

// الاختصارات الإدارية
const shortcutSchema = new mongoose.Schema({
    guildId: String,
    name: String,
    command: String,
    usageCount: { type: Number, default: 0 }
});
const Shortcut = mongoose.model('Shortcut', shortcutSchema);

// الردود التلقائية
const autoResponseSchema = new mongoose.Schema({
    guildId: String,
    trigger: String,
    reply: String
});
const AutoResponse = mongoose.model('AutoResponse', autoResponseSchema);

// نظام المستويات والـ XP
const levelSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 }
});
const LevelData = mongoose.model('LevelData', levelSchema);

// ==========================================
// 4. إعداد البوت و I Intents
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ]
});

// ==========================================
// 5. تعريف أوامر السلاش (Slash Commands)
// ==========================================
const ALLOWED_COMMANDS = [
    { name: 'حظر العضو (ban)', value: 'ban' },
    { name: 'طرد العضو (kick)', value: 'kick' },
    { name: 'سجن العضو (jail)', value: 'jail' },
    { name: 'فك سجن (unjail)', value: 'unjail' },
    { name: 'إسكات العضو (timeout)', value: 'timeout' },
    { name: 'فك الإسكات (untimeout)', value: 'untimeout' },
    { name: 'مسح الرسائل (purge)', value: 'purge' },
    { name: 'قفل الروم (lock)', value: 'lock' },
    { name: 'فتح الروم (unlock)', value: 'unlock' }
];

const commands = [
    // إعدادات السيرفر
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('إعداد قنوات السيرفر والرتب التلقائية')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt.setName('logs_channel').setDescription('روم السجلات (Logs)'))
        .addChannelOption(opt => opt.setName('welcome_channel').setDescription('روم الترحيب'))
        .addRoleOption(opt => opt.setName('auto_role').setDescription('الرتبة التلقائية للداخلين الجدد'))
        .addRoleOption(opt => opt.setName('jail_role').setDescription('رتبة السجن (Jail)')),

    // أمر السجن
    new SlashCommandBuilder()
        .setName('jail')
        .setDescription('سجن عضو وسحب رتبه')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('العضو المراد سجنه').setRequired(true)),

    // أمر فك السجن
    new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('فك سجن عضو وإعادة رتبه السابق')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(opt => opt.setName('user').setDescription('العضو المراد فك سجنه').setRequired(true)),

    // إدارة الاختصارات
    new SlashCommandBuilder()
        .setName('shortcut')
        .setDescription('إدارة الاختصارات الإدارية')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة اختصار جديد')
                .addStringOption(opt => opt.setName('name').setDescription('الكلمة/الجملة').setRequired(true))
                .addStringOption(opt => opt.setName('command').setDescription('الأمر المنفذ').setRequired(true).addChoices(...ALLOWED_COMMANDS))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف اختصار')
                .addStringOption(opt => opt.setName('name').setDescription('اسم الاختصار').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('عرض جميع الاختصارات')),

    // الردود التلقائية
    new SlashCommandBuilder()
        .setName('autoresponse')
        .setDescription('إدارة الردود التلقائية')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة رد تلقائي')
                .addStringOption(opt => opt.setName('trigger').setDescription('الكلمة المفتاحية').setRequired(true))
                .addStringOption(opt => opt.setName('reply').setDescription('الرد').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف رد تلقائي')
                .addStringOption(opt => opt.setName('trigger').setDescription('الكلمة المفتاحية').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('عرض الردود التلقائية')),

    // عرض المستوى والـ XP
    new SlashCommandBuilder()
        .setName('level')
        .setDescription('عرض مستواك الحالي أو مستوى عضو آخر')
        .addUserOption(opt => opt.setName('user').setDescription('العضو')),

    // أوامر التطهير والقفل
    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('مسح عدد معين من الرسائل')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(opt => opt.setName('amount').setDescription('عدد الرسائل (1-100)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('قفل الروم الحالي')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('فتح الروم الحالي')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    // أمر اللوقات
    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('عرض إحصائيات سجلات الاختصارات')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// ==========================================
// 6. تشغيل البوت وتسجيل الأوامر
// ==========================================
client.once('clientReady', async () => {
    console.log(`🤖 [BOT] تم تشغيل البوت بنجاح: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(c => c.toJSON()) });
        console.log('✅ [SLASH] تم تسجيل كافة أوامر السلاش بنجاح!');
    } catch (error) {
        console.error('❌ [SLASH] خطأ في تسجيل أوامر السلاش:', error);
    }
});

// ==========================================
// 7. معالجة أوامر السلاش (interactionCreate)
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // حل مشكلة The application did not respond بتأخير الرد
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const { commandName, guildId } = interaction;

    try {
        // --- أمر Setup ---
        if (commandName === 'setup') {
            const logsChannel = interaction.options.getChannel('logs_channel');
            const welcomeChannel = interaction.options.getChannel('welcome_channel');
            const autoRole = interaction.options.getRole('auto_role');
            const jailRole = interaction.options.getRole('jail_role');

            let settings = await GuildSettings.findOne({ guildId });
            if (!settings) settings = new GuildSettings({ guildId });

            if (logsChannel) settings.logChannelId = logsChannel.id;
            if (welcomeChannel) settings.welcomeChannelId = welcomeChannel.id;
            if (autoRole) settings.autoRoleId = autoRole.id;
            if (jailRole) settings.jailRoleId = jailRole.id;

            await settings.save();
            return interaction.editReply({ content: '⚙️ تم حفظ إعدادات السيرفر بنجاح!' });
        }

        // --- أمر Jail ---
        if (commandName === 'jail') {
            const target = interaction.options.getMember('user');
            if (!target) return interaction.editReply({ content: '❌ لم يتم العثور على العضو.' });

            const settings = await GuildSettings.findOne({ guildId });
            if (!settings || !settings.jailRoleId) return interaction.editReply({ content: '❌ لم يتم ضبط رتبة السجن في `/setup` بعد.' });

            const jailRole = interaction.guild.roles.cache.get(settings.jailRoleId);
            if (!jailRole) return interaction.editReply({ content: '❌ رتبة السجن المحددة غير موجودة بالسيرفر.' });

            // حفظ كافة رتب العضو الحالية واستثنائها من رتبة everyone
            const userRoles = target.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.id);
            
            await JailData.findOneAndUpdate(
                { guildId, userId: target.id },
                { oldRoles: userRoles },
                { upsert: true }
            );

            // تجريد العضو من كل الرتب وإعطاء رتبة السجن
            await target.roles.set([jailRole.id]).catch(() => {});
            
            sendLog(guildId, '🔒 سجن عضو', `**العضو:** ${target.user.tag}\n**المسبب:** ${interaction.user.tag}`);
            return interaction.editReply({ content: `🔒 تم سجن ${target} وسحب رتبه الأصلية بنجاح.` });
        }

        // --- أمر Unjail ---
        if (commandName === 'unjail') {
            const target = interaction.options.getMember('user');
            if (!target) return interaction.editReply({ content: '❌ لم يتم العثور على العضو.' });

            const jailRecord = await JailData.findOneAndDelete({ guildId, userId: target.id });
            if (!jailRecord) return interaction.editReply({ content: '❌ هذا العضو ليس مسجوناً في قاعدة البيانات.' });

            // إرجاع كافة رتبه السابقة
            await target.roles.set(jailRecord.oldRoles).catch(() => {});

            sendLog(guildId, '🔓 فك سجن عضو', `**العضو:** ${target.user.tag}\n**المسبب:** ${interaction.user.tag}`);
            return interaction.editReply({ content: `🔓 تم فك سجن ${target} وإعادة رتبه السابقة بالكامل.` });
        }

        // --- أمر Shortcut ---
        if (commandName === 'shortcut') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'add') {
                const name = interaction.options.getString('name').trim().toLowerCase();
                const command = interaction.options.getString('command').toLowerCase();

                await Shortcut.findOneAndUpdate({ guildId, name }, { command }, { upsert: true });
                return interaction.editReply({ content: `✅ تم ربط الاختصار **\`${name}\`** بالأمر **\`${command}\`**.` });
            }
            if (sub === 'remove') {
                const name = interaction.options.getString('name').trim().toLowerCase();
                const res = await Shortcut.findOneAndDelete({ guildId, name });
                if (!res) return interaction.editReply({ content: `❌ الاختصار \`${name}\` غير موجود.` });
                return interaction.editReply({ content: `🗑️ تم حذف الاختصار \`${name}\`.` });
            }
            if (sub === 'list') {
                const list = await Shortcut.find({ guildId });
                if (!list.length) return interaction.editReply({ content: '📭 لا توجد اختصارات مسجلة.' });
                const text = list.map((s, i) => `**${i + 1}.** \`${s.name}\` ➔ \`${s.command}\` *(استُخدم ${s.usageCount} مرة)*`).join('\n');
                return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('⚡ قائمة الاختصارات').setDescription(text).setColor(0x5865F2)] });
            }
        }

        // --- أمر Autoresponse ---
        if (commandName === 'autoresponse') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'add') {
                const trigger = interaction.options.getString('trigger').trim().toLowerCase();
                const reply = interaction.options.getString('reply');
                await AutoResponse.findOneAndUpdate({ guildId, trigger }, { reply }, { upsert: true });
                return interaction.editReply({ content: `✅ تم إضافة الرد التلقائي للكلمة: **\`${trigger}\`**` });
            }
            if (sub === 'remove') {
                const trigger = interaction.options.getString('trigger').trim().toLowerCase();
                const res = await AutoResponse.findOneAndDelete({ guildId, trigger });
                if (!res) return interaction.editReply({ content: `❌ الكلمة \`${trigger}\` غير موجودة.` });
                return interaction.editReply({ content: `🗑️ تم حذف الرد التلقائي.` });
            }
            if (sub === 'list') {
                const list = await AutoResponse.find({ guildId });
                if (!list.length) return interaction.editReply({ content: '📭 لا توجد ردود تلقائية.' });
                const text = list.map((a, i) => `**${i + 1}.** \`${a.trigger}\` ➔ ${a.reply}`).join('\n');
                return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🤖 الردود التلقائية').setDescription(text).setColor(0x5865F2)] });
            }
        }

        // --- أمر Level ---
        if (commandName === 'level') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const data = await LevelData.findOne({ guildId, userId: targetUser.id }) || { level: 0, xp: 0 };
            const nextXP = data.level * 100 + 100;
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`📊 مستوى ${targetUser.username}`)
                        .addFields(
                            { name: 'المستوى (Level)', value: `\`${data.level}\``, inline: true },
                            { name: 'الخبرة (XP)', value: `\`${data.xp} / ${nextXP}\``, inline: true }
                        )
                        .setColor(0x00FF7F)
                ]
            });
        }

        // --- أمر Purge ---
        if (commandName === 'purge') {
            const amount = interaction.options.getInteger('amount');
            if (amount < 1 || amount > 100) return interaction.editReply({ content: '❌ أدخل عدداً بين 1 و 100.' });

            await interaction.channel.bulkDelete(amount, true);
            sendLog(guildId, '🗑️ مسح رسائل', `**القناة:** ${interaction.channel}\n**العدد:** ${amount}\n**المسبب:** ${interaction.user.tag}`);
            return interaction.editReply({ content: `🗑️ تم مسح ${amount} رسالة بنجاح.` });
        }

        // --- أوامر Lock / Unlock ---
        if (commandName === 'lock') {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
            return interaction.editReply({ content: '🔒 تم قفل هذه القناة.' });
        }
        if (commandName === 'unlock') {
            await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
            return interaction.editReply({ content: '🔓 تم فتح هذه القناة.' });
        }

        // --- أمر Logs ---
        if (commandName === 'logs') {
            const shortcuts = await Shortcut.find({ guildId });
            if (!shortcuts.length) return interaction.editReply({ content: '📭 لا توجد إحصائيات اختصارات حتى الآن.' });

            const logList = shortcuts.map((s, i) => `**${i + 1}.** \`${s.name}\` ➔ \`${s.command}\` | 🔄 **مرات الاستخدام:** ${s.usageCount}`).join('\n');
            return interaction.editReply({
                embeds: [new EmbedBuilder().setTitle('📊 سجلات إحصائيات الاختصارات').setDescription(logList).setColor(0x3498DB)]
            });
        }

    } catch (err) {
        console.error('Error during command execution:', err);
        return interaction.editReply({ content: '❌ حدث خطأ داخلي أثناء تنفيذ هذا الأمر.' }).catch(() => {});
    }
});

// ==========================================
// 8. توحيد الأحداث بملف واحد (messageCreate)
// ==========================================
const xpCooldown = new Set();

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim().toLowerCase();
    const guildId = message.guild.id;

    // A. الردود التلقائية
    const autoRes = await AutoResponse.findOne({ guildId, trigger: content });
    if (autoRes) {
        return message.reply(autoRes.reply).catch(() => {});
    }

    // B. الاختصارات الإدارية (للمشرفين فقط)
    if (message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const shortcuts = await Shortcut.find({ guildId }).sort({ name: -1 });
        const shortcut = shortcuts.find(s => new RegExp(`^${s.name.toLowerCase()}(?:\\s+|$)`).test(content));

        if (shortcut) {
            shortcut.usageCount += 1;
            await shortcut.save();

            const timeNow = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
            console.log(`[SHORTCUT LOG] ⏰ ${timeNow} | 👤 ${message.author.tag} | ⚡ "${shortcut.name}" | 🔄 مرات الاستخدام: ${shortcut.usageCount}`);
            
            sendLog(guildId, '⚡ استخدام اختصار إداري', `**المسبب:** ${message.author.tag}\n**الاختصار:** \`${shortcut.name}\`\n**الأمر:** \`${shortcut.command}\`\n**الاستخدام الإجمالي:** ${shortcut.usageCount} مرة`);

            return executeShortcutCommand(message, shortcut.command);
        }
    }

    // C. نظام اللفلات والـ XP
    if (!xpCooldown.has(message.author.id)) {
        let levelData = await LevelData.findOne({ guildId, userId: message.author.id });
        if (!levelData) levelData = new LevelData({ guildId, userId: message.author.id });

        levelData.xp += Math.floor(Math.random() * 15) + 10;
        const nextLevel = levelData.level * 100 + 100;

        if (levelData.xp >= nextLevel) {
            levelData.level += 1;
            levelData.xp -= nextLevel;
            message.channel.send(`🎉 مبروك ${message.author}! ارتقيت إلى المستوى **${levelData.level}** 🚀`).then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
        }

        await levelData.save();
        xpCooldown.add(message.author.id);
        setTimeout(() => xpCooldown.delete(message.author.id), 60000);
    }
});

// تنفيذ خيارات الاختصارات الإدارية
async function executeShortcutCommand(message, command) {
    const args = message.content.split(/\s+/).slice(1);
    const mention = message.mentions.members.first();

    try {
        if (command === 'ban' && mention?.bannable) {
            await mention.ban({ reason: `اختصار بواسطة ${message.author.tag}` });
            return message.reply(`🔨 تم حظر ${mention.user.tag}`);
        }
        if (command === 'kick' && mention?.kickable) {
            await mention.kick(`اختصار بواسطة ${message.author.tag}`);
            return message.reply(`👢 تم طرد ${mention.user.tag}`);
        }
        if (command === 'lock') {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
            return message.reply('🔒 تم قفل القناة.');
        }
        if (command === 'unlock') {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
            return message.reply('🔓 تم فتح القناة.');
        }
        if (command === 'purge') {
            const amount = parseInt(args[0]) || 10;
            await message.channel.bulkDelete(Math.min(amount, 100), true);
            return message.reply(`🗑️ تم مسح ${amount} رسالة.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
        }
        if (command === 'timeout' && mention) {
            const timeMatch = args.find(a => /^\d+(m|h|d)$/i.test(a)) || '10m';
            const match = timeMatch.match(/^(\d+)(m|h|d)$/i);
            const ms = parseInt(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
            await mention.timeout(ms, `اختصار بواسطة ${message.author.tag}`);
            return message.reply(`⏱️ تم إسكات ${mention} لمدة ${timeMatch}.`);
        }
        if (command === 'untimeout' && mention) {
            await mention.timeout(null);
            return message.reply(`🔓 تم فك الإسكات عن ${mention}`);
        }
    } catch (e) {
        console.error('Shortcut execution error:', e);
    }
}

// ==========================================
// 9. أحداث الأعضاء: Auto-Role + Welcome Canvas
// ==========================================
client.on('guildMemberAdd', async (member) => {
    const settings = await GuildSettings.findOne({ guildId: member.guild.id });
    if (!settings) return;

    // A. إعطاء الرتبة التلقائية
    if (settings.autoRoleId) {
        const autoRole = member.guild.roles.cache.get(settings.autoRoleId);
        if (autoRole) await member.roles.add(autoRole).catch(console.error);
    }

    // B. إنشاء صورة الترحيب باستخدام Canvas
    if (settings.welcomeChannelId) {
        const welcomeChannel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (welcomeChannel) {
            try {
                const canvas = createCanvas(800, 350);
                const ctx = canvas.getContext('2d');

                // خلفية
                ctx.fillStyle = '#1e1f22';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // إطار خارجي
                ctx.strokeStyle = '#5865F2';
                ctx.lineWidth = 8;
                ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

                // كتابة النص
                ctx.fillStyle = '#ffffff';
                ctx.font = '32px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`WELCOME TO THE SERVER`, 400, 220);

                ctx.fillStyle = '#5865F2';
                ctx.font = '28px sans-serif';
                ctx.fillText(`${member.user.tag}`, 400, 265);

                ctx.fillStyle = '#b5bac1';
                ctx.font = '20px sans-serif';
                ctx.fillText(`Member #${member.guild.memberCount}`, 400, 305);

                // رسم الصورة الشخصية (Avatar) بشكل دائري
                const avatar = await loadImage(member.user.displayAvatarURL({ extension: 'png', size: 256 }));
                ctx.save();
                ctx.beginPath();
                ctx.arc(400, 105, 60, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatar, 340, 45, 120, 120);
                ctx.restore();

                const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'welcome.png' });
                welcomeChannel.send({ content: `👋 أهلاً بك يا ${member} في **${member.guild.name}**!`, files: [attachment] });
            } catch (err) {
                console.error('Welcome image error:', err);
                welcomeChannel.send(`👋 أهلاً بك يا ${member} في **${member.guild.name}**! أنت العضو رقم **${member.guild.memberCount}**.`);
            }
        }
    }

    // C. لوق الانضمام
    sendLog(member.guild.id, '📥 دخول عضو جديد', `**العضو:** ${member.user.tag} (${member.id})\n**عدد الأعضاء:** ${member.guild.memberCount}`);
});

client.on('guildMemberRemove', async (member) => {
    sendLog(member.guild.id, '📤 خروج عضو', `**العضو:** ${member.user.tag} (${member.id})\n**المتبقي:** ${member.guild.memberCount}`);
});

// ==========================================
// 10. نظام اللوقات الشامل (Audit Logs)
// ==========================================

// لوق حذف الرسائل
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    sendLog(message.guild.id, '🗑️ حذف رسالة', `**الكاتب:** ${message.author?.tag}\n**القناة:** ${message.channel}\n**الرسالة:** ${message.content || 'محتوى غير نصي'}`);
});

// لوق تعديل الرسائل
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    sendLog(oldMsg.guild.id, '✏️ تعديل رسالة', `**الكاتب:** ${oldMsg.author?.tag}\n**القناة:** ${oldMsg.channel}\n**قبل:** ${oldMsg.content}\n**بعد:** ${newMsg.content}`);
});

// لوق القنوات الصوتية
client.on('voiceStateUpdate', async (oldState, newState) => {
    const guildId = newState.guild.id || oldState.guild.id;
    const member = newState.member;

    if (!oldState.channelId && newState.channelId) {
        sendLog(guildId, '🔊 دخول روم صوتي', `**العضو:** ${member.user.tag}\n**الروم:** ${newState.channel.name}`);
    } else if (oldState.channelId && !newState.channelId) {
        sendLog(guildId, '🔇 خروج من روم صوتي', `**العضو:** ${member.user.tag}\n**الروم:** ${oldState.channel.name}`);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        sendLog(guildId, '🔄 انتقال بين الرومات الصوتية', `**العضو:** ${member.user.tag}\n**من:** ${oldState.channel.name}\n**إلى:** ${newState.channel.name}`);
    }
});

// دالة مساعدة لإرسال اللوقات إلى الروم المخصص
async function sendLog(guildId, title, description) {
    try {
        const settings = await GuildSettings.findOne({ guildId });
        if (!settings || !settings.logChannelId) return;

        const logChannel = client.channels.cache.get(settings.logChannelId);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(0x2B2D31)
            .setTimestamp();

        logChannel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        console.error('Log dispatch error:', e);
    }
}

// ==========================================
// 11. تسجيل الدخول
// ==========================================
client.login(process.env.TOKEN);
