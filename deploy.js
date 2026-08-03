const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const token = ''; '.MTUzMzIzOTYzMzI4MTAyODIwNw.GpgL8t.1jzd7Ya2bXNS1L3FxHKX56izc3BNvC3FYBwAWU.'; 
const clientId = '1533239633281028207'; 

const commands = [
    new SlashCommandBuilder()
        .setName('سجن')
        .setDescription('سجن عضو')
        .addUserOption(option => option.setName('العضو').setDescription('العضو المراد سجنه').setRequired(true))
        .addStringOption(option => option.setName('السبب').setDescription('سبب السجن')),

    new SlashCommandBuilder()
        .setName('فك_السجن')
        .setDescription('فك سجن عضو')
        .addUserOption(option => option.setName('العضو').setDescription('العضو المراد فك سجنه').setRequired(true)),

    new SlashCommandBuilder()
        .setName('add_role') // تم تغيير الاسم لتجنب المسافة
        .setDescription('اعطاء رولات')
        .addUserOption(option => option.setName('العضو').setDescription('العضو المراد إعطاؤه الرول').setRequired(true))
        .addStringOption(option => option.setName('اسم_الرول').setDescription('اسم الرول').setRequired(true)),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر نهائي')
        .addUserOption(option => option.setName('العضو').setDescription('العضو المراد حظره').setRequired(true))
        .addStringOption(option => option.setName('السبب').setDescription('سبب الحظر')),
        
    new SlashCommandBuilder()
        .setName('تايم')
        .setDescription('إسكات العضو')
        .addUserOption(option => option.setName('العضو').setDescription('العضو المراد إسكاته').setRequired(true))
        .addIntegerOption(option => option.setName('مدة_الحظر').setDescription('المدة بالدقائق').setRequired(true)),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو')
        .addUserOption(option => option.setName('العضو').setDescription('العضو المراد طرده').setRequired(true))
        .addStringOption(option => option.setName('السبب').setDescription('سبب الطرد'))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('...جاري تسجيل الأوامر');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('تم تسجيل الأوامر بنجاح!');
    } catch (error) {
        console.error('حدث خطأ أثناء تسجيل الأوامر:', error);
    }
})();
