require('dotenv').config({ path: `${__dirname}/.env` });
const { REST, Routes } = require('discord.js');

// 📇 نفس تعريفات الأوامر المستخدمة في البوت (مصدر واحد — لا تكرار)
const { slashCommands } = require('./commands.js');

const token = process.env.TOKEN || process.env.DISCORD_TOKEN;

// نستخرج آيدي التطبيق من التوكن نفسه — أضمن من أي متغيّر يدوي
function appIdFromToken(value) {
    try {
        return Buffer.from(String(value).split('.')[0], 'base64').toString('utf8');
    } catch {
        return '';
    }
}

const clientId =
    process.env.CLIENT_ID ||
    appIdFromToken(token) ||
    '1533239633281028207';

if (!token) {
    throw new Error('TOKEN أو DISCORD_TOKEN غير موجود في Environment Variables.');
}

// طريقة الاستخدام:
//   node deploy.js                 -> تسجيل عام (كل السيرفرات)
//   node deploy.js --guild <id>    -> تسجيل فوري في سيرفر واحد
//   node deploy.js --clear         -> حذف الأوامر العامة
const args = process.argv.slice(2);
const guildFlag = args.indexOf('--guild');
const guildId = guildFlag !== -1 ? args[guildFlag + 1] : null;
const clear = args.includes('--clear');

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        const route = guildId
            ? Routes.applicationGuildCommands(clientId, guildId)
            : Routes.applicationCommands(clientId);

        const body = clear ? [] : slashCommands;

        console.log(
            `...جاري تسجيل الأوامر (${guildId ? `سيرفر ${guildId}` : 'عام'})` +
            (clear ? ' — حذف' : ` — ${body.length} أمر`)
        );

        const result = await rest.put(route, { body });

        console.log(
            `تم تسجيل الأوامر بنجاح! (${Array.isArray(result) ? result.length : 0} أمر)`
        );
    } catch (error) {
        console.error('حدث خطأ أثناء تسجيل الأوامر:', error);
        process.exit(1);
    }
})();
