const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder, 
    PermissionFlagsBits 
} = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');

// ==========================================
// إعداد سيرفر الويب لمنصة Render (لمنع توقف البوت)
// ==========================================
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running and database is connected!'));
app.listen(port, () => console.log(`🌐 السيرفر يعمل على المنفذ ${port} (لـ Render)`));

// ==========================================
// إعداد قاعدة البيانات MongoDB (للتخزين الدائم)
// ==========================================
// تأكد من إضافة MONGO_URI في Environment Variables في منصة Render
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح!'))
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

const shortcutSchema = new mongoose.Schema({
    guildId: String,
    name: String,
    command: String,
    usageCount: { type: Number, default: 0 }
});
const Shortcut = mongoose.model('Shortcut', shortcutSchema);

// ==========================================
// إعداد البوت
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

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

const shortcutCommand = new SlashCommandBuilder()
    .setName('shortcut')
    .setDescription('إدارة الاختصارات الإدارية')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName('add')
            .setDescription('إضافة اختصار جديد')
            .addStringOption(opt => opt.setName('name').setDescription('الكلمة/الجملة (مثال: قفل أو نواف يحبك)').setRequired(true))
            .addStringOption(opt => opt.setName('command').setDescription('اختر الأمر').setRequired(true).addChoices(...ALLOWED_COMMANDS))
    )
    .addSubcommand(sub =>
        sub.setName('remove')
            .setDescription('حذف اختصار')
            .addStringOption(opt => opt.setName('name').setDescription('اسم الاختصار').setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('عرض جميع الاختصارات المضافة')
    );

client.once('clientReady', async () => {
    console.log(`🤖 تم تشغيل البوت: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: [shortcutCommand.toJSON()] });
        console.log('✅ تم تسجيل أوامر السلاش بنجاح!');
    } catch (error) {
        console.error('❌ خطأ أثناء التسجيل:', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'shortcut') {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'add') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const command = interaction.options.getString('command').toLowerCase();

            let shortcut = await Shortcut.findOne({ guildId, name });
            if (shortcut) {
                shortcut.command = command;
            } else {
                shortcut = new Shortcut({ guildId, name, command });
            }
            await shortcut.save();

            return interaction.reply({ content: `✅ تم ربط الاختصار **\`${name}\`** بالأمر **\`${command}\`** بنجاح!`, ephemeral: true });
        }

        if (sub === 'remove') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const result = await Shortcut.findOneAndDelete({ guildId, name });

            if (!result) return interaction.reply({ content: `❌ لم يتم العثور على اختصار باسم \`${name}\`.`, ephemeral: true });
            return interaction.reply({ content: `🗑️ تم حذف الاختصار \`${name}\` بنجاح.`, ephemeral: true });
        }

        if (sub === 'list') {
            const shortcuts = await Shortcut.find({ guildId });
            if (!shortcuts.length) return interaction.reply({ content: '📭 لا توجد اختصارات.', ephemeral: true });

            const list = shortcuts.map((s, i) => `**${i + 1}.** \`${s.name}\` ➔ \`${s.command}\` *(استُخدم ${s.usageCount} مرة)*`).join('\n');
            const embed = new EmbedBuilder().setTitle('⚡ قائمة الاختصارات').setDescription(list).setColor(0x5865F2);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    const content = message.content.trim().toLowerCase();
    
    // جلب الاختصارات وترتيبها من الأطول للأقصر لتفادي تداخل الكلمات (مثل "نواف" و "نواف يحبك")
    const shortcuts = await Shortcut.find({ guildId: message.guild.id });
    if (!shortcuts.length) return;
    shortcuts.sort((a, b) => b.name.length - a.name.length);

    // البحث عن الاختصار في بداية الرسالة
    const shortcut = shortcuts.find(s => {
        const regex = new RegExp(`^${s.name.toLowerCase()}(?:\\s+|$)`);
        return regex.test(content);
    });

    if (!shortcut) return;

    // استخراج المعطيات بعد الاختصار
    const argsString = message.content.slice(shortcut.name.length).trim();
    const args = argsString.length > 0 ? argsString.split(/\s+/) : [];
    
    const cmd = shortcut.command.toLowerCase();
    const mention = message.mentions.members.first();

    try {
        // تحديث السجلات وعدد الاستخدام
        shortcut.usageCount += 1;
        await shortcut.save();
        
        // اللوق (Log) في الكونسول
        const timeNow = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
        console.log(`[LOG] ⏰ الوقت: ${timeNow} | 👤 المسبب: ${message.author.tag} | ⚡ الاختصار: "${shortcut.name}" | 🔧 الأمر: ${cmd} | 🔄 مرات الاستخدام: ${shortcut.usageCount}`);

        // تنفيذ الأوامر
        if (cmd === 'ban') {
            if (!mention || !mention.bannable) return message.reply('❌ لا أملك صلاحية حظره أو لم تقم بمنشن.');
            await mention.ban({ reason: `اختصار بواسطة ${message.author.tag}` });
            return message.reply(`🔨 تم حظر ${mention.user.tag}`);
        }
        if (cmd === 'kick') {
            if (!mention || !mention.kickable) return message.reply('❌ لا أملك صلاحية طرده.');
            await mention.kick(`اختصار بواسطة ${message.author.tag}`);
            return message.reply(`👢 تم طرد ${mention.user.tag}`);
        }
        if (cmd === 'jail') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            let jailRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'jail' || r.name === 'مسجون');
            if (!jailRole) return message.reply('❌ لم يتم العثور على رتبة `Jail`.');
            await mention.roles.add(jailRole);
            return message.reply(`🔒 تم سجن ${mention}`);
        }
        if (cmd === 'unjail') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            let jailRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'jail' || r.name === 'مسجون');
            if (jailRole && mention.roles.cache.has(jailRole.id)) {
                await mention.roles.remove(jailRole);
                return message.reply(`🔓 تم فك سجن ${mention}`);
            }
            return message.reply('❌ العضو ليس مسجوناً.');
        }
        if (cmd === 'timeout') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            // البحث عن الوقت في أي مكان بعد المنشن
            const timeMatch = args.find(a => /^\d+(m|h|d)$/i.test(a));
            if (!timeMatch) return message.reply('❌ يرجى تحديد المدة (مثال: 10m أو 1h).');
            const match = timeMatch.match(/^(\d+)(m|h|d)$/i);
            const ms = parseInt(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
            await mention.timeout(ms, `اختصار بواسطة ${message.author.tag}`);
            return message.reply(`⏱️ تم إسكات ${mention} لمدة ${timeMatch}.`);
        }
        if (cmd === 'untimeout') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            await mention.timeout(null);
            return message.reply(`🔓 تم فك الإسكات عن ${mention}`);
        }
        if (cmd === 'purge') {
            const amountArg = args.find(a => !isNaN(parseInt(a)));
            const amount = parseInt(amountArg);
            if (isNaN(amount) || amount < 1 || amount > 100) return message.reply('❌ حدد عدد رسائل بين 1 و 100.');
            await message.channel.bulkDelete(amount, true);
            return message.reply(`🗑️ تم مسح ${amount} رسالة.`).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
        }
        if (cmd === 'lock') {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
            return message.reply('🔒 تم قفل الروم.');
        }
        if (cmd === 'unlock') {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
            return message.reply('🔓 تم فتح الروم.');
        }

    } catch (err) {
        console.error('Error in shortcut:', err);
        return message.reply('❌ حدث خطأ داخلي، تأكد من أن البوت يملك صلاحيات كافية وأنه أعلى رتبة.');
    }
});

client.login(process.env.TOKEN);
