const { 
    Client, 
    GatewayIntentBits, 
    SlashCommandBuilder, 
    REST, 
    Routes, 
    EmbedBuilder, 
    PermissionFlagsBits 
} = require('discord.js');

// قم باستدعاء دالة قاعدة البيانات الخاصة بك هنا (MongoDB)
// const { getSettings } = require('./database/settings'); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// قائمة الخيارات التي ستظهر في السلاش كوماند
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

// 1. بناء أمر السلاش
const shortcutCommand = new SlashCommandBuilder()
    .setName('shortcut')
    .setDescription('إدارة الاختصارات الإدارية')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName('add')
            .setDescription('إضافة اختصار جديد')
            .addStringOption(opt =>
                opt.setName('name')
                    .setDescription('الكلمة التي ستكتبها في الدردشة (مثال: قفل أو سجن)')
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName('command')
                    .setDescription('اختر الأمر الذي سيتم تنفيذه')
                    .setRequired(true)
                    .addChoices(...ALLOWED_COMMANDS)
            )
    )
    .addSubcommand(sub =>
        sub.setName('remove')
            .setDescription('حذف اختصار')
            .addStringOption(opt =>
                opt.setName('name')
                    .setDescription('اسم الاختصار المراد حذفه')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('عرض جميع الاختصارات المضافة')
    );

// 2. تسجيل الأوامر عند التشغيل
client.once('ready', async () => {
    console.log(`🤖 تم تشغيل البوت: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: [shortcutCommand.toJSON()] }
        );
        console.log('✅ تم تسجيل أمر /shortcut مع القائمة المنسدلة بنجاح!');
    } catch (error) {
        console.error('❌ حدث خطأ أثناء التسجيل:', error);
    }
});

// 3. معالجة الأمر السلاش
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'shortcut') {
        const sub = interaction.options.getSubcommand();
        
        // استدعاء قاعدة البيانات الخاصة بك
        // const settings = await getSettings(interaction.guild.id);
        
        // كود مؤقت للتجربة في حال لم تضف قاعدة البيانات بعد
        if (!client.db) client.db = { shortcuts: [] }; 
        const settings = client.db; 
        settings.save = async () => {}; // محاكاة لحفظ البيانات

        if (sub === 'add') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const command = interaction.options.getString('command').toLowerCase();

            const existingIndex = settings.shortcuts.findIndex(s => s.name === name);
            if (existingIndex !== -1) {
                settings.shortcuts[existingIndex].command = command;
            } else {
                settings.shortcuts.push({ name, command });
            }

            await settings.save();
            return interaction.reply({
                content: `✅ تم ربط الاختصار **\`${name}\`** بالأمر **\`${command}\`** بنجاح!`,
                ephemeral: true
            });
        }

        if (sub === 'remove') {
            const name = interaction.options.getString('name').trim().toLowerCase();
            const initialCount = settings.shortcuts.length;

            settings.shortcuts = settings.shortcuts.filter(s => s.name !== name);

            if (settings.shortcuts.length === initialCount) {
                return interaction.reply({ content: `❌ لم يتم العثور على اختصار باسم \`${name}\`.`, ephemeral: true });
            }

            await settings.save();
            return interaction.reply({ content: `🗑️ تم حذف الاختصار \`${name}\` بنجاح.`, ephemeral: true });
        }

        if (sub === 'list') {
            if (!settings.shortcuts.length) {
                return interaction.reply({ content: '📭 لا توجد اختصارات مضافة حالياً.', ephemeral: true });
            }

            const list = settings.shortcuts
                .map((s, index) => `**${index + 1}.** \`${s.name}\` ➔ \`${s.command}\``)
                .join('\n');

            const embed = new EmbedBuilder()
                .setTitle('⚡ قائمة الاختصارات المفعّلة')
                .setDescription(list)
                .setColor(0x5865F2);

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
});

// 4. تنفيذ الاختصار في الدردشة
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return;

    // استدعاء الاختصارات من قاعدة البيانات
    // const settings = await getSettings(message.guild.id);
    const settings = client.db || { shortcuts: [] };

    if (!settings.shortcuts.length) return;

    const args = message.content.trim().split(/\s+/);
    const triggerWord = args[0].toLowerCase();

    const shortcut = settings.shortcuts.find(s => s.name === triggerWord);
    if (!shortcut) return;

    const cmd = shortcut.command.toLowerCase();
    const mention = message.mentions.members.first();

    try {
        if (cmd === 'ban') {
            if (!mention || !mention.bannable) return message.reply('❌ لا أملك صلاحية حظر هذا العضو أو لم تمنشن أحداً.');
            await mention.ban({ reason: `اختصار بواسطة ${message.author.tag}` });
            return message.reply(`🔨 تم حظر ${mention.user.tag}`);
        }
        
        if (cmd === 'kick') {
            if (!mention || !mention.kickable) return message.reply('❌ لا أملك صلاحية طرد هذا العضو.');
            await mention.kick(`اختصار بواسطة ${message.author.tag}`);
            return message.reply(`👢 تم طرد ${mention.user.tag}`);
        }
        
        if (cmd === 'jail') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            let jailRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'jail');
            if (!jailRole) return message.reply('❌ لم يتم العثور على رتبة `Jail`.');
            await mention.roles.add(jailRole);
            return message.reply(`🔒 تم سجن ${mention}`);
        }
        
        if (cmd === 'unjail') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            let jailRole = message.guild.roles.cache.find(r => r.name.toLowerCase() === 'jail');
            if (jailRole && mention.roles.cache.has(jailRole.id)) {
                await mention.roles.remove(jailRole);
                return message.reply(`🔓 تم فك سجن ${mention}`);
            }
            return message.reply('❌ العضو ليس مسجوناً.');
        }
        
        if (cmd === 'timeout') {
            if (!mention || !args[2]) return message.reply('❌ يرجى منشن العضو وتحديد المدة (مثال: 10m).');
            const match = args[2].match(/^(\d+)(m|h|d)$/i);
            if (!match) return message.reply('❌ صيغة الوقت غير صحيحة.');
            const ms = parseInt(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
            await mention.timeout(ms, `اختصار بواسطة ${message.author.tag}`);
            return message.reply(`⏱️ تم إسكات ${mention} لمدة ${args[2]}.`);
        }
        
        if (cmd === 'untimeout') {
            if (!mention) return message.reply('❌ يرجى منشن العضو.');
            await mention.timeout(null);
            return message.reply(`🔓 تم فك الإسكات عن ${mention}`);
        }
        
        if (cmd === 'purge') {
            const amount = parseInt(args[1]);
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
        return message.reply('❌ حدث خطأ، تأكد من صلاحيات البوت وأنه أعلى من رتبة العضو.');
    }
});

client.login(process.env.TOKEN);
