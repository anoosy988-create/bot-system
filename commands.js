// ======================================================
// تعريفات أوامر Slash — المصدر الوحيد للحقيقة
// ======================================================
// يُستخدم من index.js (التسجيل التلقائي) ومن deploy.js (التسجيل اليدوي).
// لا تكرر التعريف في مكان ثانٍ حتى لا تتعارض النسخ وتضيع الأوامر الجديدة.

const { SlashCommandBuilder, ChannelType } = require('discord.js');

const PROTECTION_ACTIONS = [
    { name: '🔨 حظر', value: 'ban' },
    { name: '👢 طرد', value: 'kick' },
    { name: '🔇 تايم', value: 'timeout' },
    { name: '🔒 سجن', value: 'jail' },
    { name: '🎭 إزالة الرتب', value: 'removeroles' }
];

const slashCommands = [

    new SlashCommandBuilder()
        .setName('jail')
        .setDescription('سجن عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('فك سجن عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد فك سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر عضو من السيرفر')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد حظره')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('سبب الحظر')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('فك حظر عضو')
        
        .addStringOption(o =>
            o.setName('user_id')
                .setDescription('آيدي العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد طرده')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('سبب الطرد')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('إعطاء تايم أوت لعضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('duration')
                .setDescription('المدة مثل 10m أو 1h أو 1d')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('إزالة التايم أوت')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('إعطاء رتبة لعضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addRoleOption(o =>
            o.setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('role-remove')
        .setDescription('إزالة رتبة من عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addRoleOption(o =>
            o.setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('حذف عدد من الرسائل')
        
        .addIntegerOption(o =>
            o.setName('amount')
                .setDescription('عدد الرسائل من 1 إلى 100')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('قفل الروم')
        
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المراد قفله')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('فتح الروم')
        
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المراد فتحه')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('إعداد نظام الترحيب')
        
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('تعيين الترحيب')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الترحيب')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message')
                        .setDescription('رسالة الترحيب (بالمتغيرات)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('card')
                .setDescription('تفعيل أو إيقاف صورة الترحيب (Canvas)')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الصورة؟')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('variables')
                .setDescription('عرض متغيرات رسالة الترحيب')
        )
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('إيقاف الترحيب')
        )

        // ===== صورة الترحيب — أي أحد عنده صلاحية يقدر يحطها =====
        .addSubcommandGroup(group =>
            group.setName('image')
                .setDescription('صورة الترحيب — برابط أو بمرفق')
                .addSubcommand(sub =>
                    sub.setName('set')
                        .setDescription('تعيين صورة الترحيب (تجي فوق البطاقة مباشرة)')
                        .addStringOption(o =>
                            o.setName('url')
                                .setDescription('رابط الصورة المباشر (https://...png)')
                                .setRequired(false)
                        )
                        .addAttachmentOption(o =>
                            o.setName('file')
                                .setDescription('أو ارفع الصورة كمرفق')
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('حذف صورة الترحيب والرجوع للبطاقة')
                )
        ),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('عرض عدد السيرفرات التي فيها البوت'),

    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('إنشاء وإرسال إيمبد مخصص')
        
        .addStringOption(o =>
            o.setName('description')
                .setDescription('نص الإيمبد (مطلوب)')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('title')
                .setDescription('عنوان الإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('color')
                .setDescription('اللون بصيغة Hex مثل #5865F2')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('footer')
                .setDescription('النص السفلي للإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('image')
                .setDescription('رابط صورة كبيرة للإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('thumbnail')
                .setDescription('رابط صورة مصغرة للإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('url')
                .setDescription('رابط يفتح عند النقر على العنوان')
                .setRequired(false)
        )
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم الذي سيظهر فيه الإيمبد (الافتراضي: الروم الحالي)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addBooleanOption(o =>
            o.setName('visible')
                .setDescription('إظهار الإيمبد للجميع (الافتراضي: خاص لك فقط)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('autoresponse')
        .setDescription('إدارة الردود التلقائية')
        
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة رد تلقائي')
                .addStringOption(o =>
                    o.setName('trigger')
                        .setDescription('الكلمة أو العبارة')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('response')
                        .setDescription('الرد')
                        .setRequired(true)
                )
                .addBooleanOption(o =>
                    o.setName('staff_only')
                        .setDescription('هل يلزم رتبة ستريتر ليستجيب؟ (الافتراضي: أي عضو)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف رد تلقائي')
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('تعديل رد تلقائي')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض كل الردود التلقائية')
        ),

    new SlashCommandBuilder()
        .setName('shortcut')
        .setDescription('إدارة الاختصارات')
        
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة اختصار')
                .addStringOption(o =>
                    o.setName('name')
                        .setDescription('اسم الاختصار')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('command')
                        .setDescription('الأمر الإداري الذي سينفذه الاختصار')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔨 ban', value: 'ban' },
                            { name: '🔓 unban', value: 'unban' },
                            { name: '👢 kick', value: 'kick' },
                            { name: '🔒 jail', value: 'jail' },
                            { name: '🔓 unjail', value: 'unjail' },
                            { name: '⏱️ timeout', value: 'timeout' },
                            { name: '⏱️ untimeout', value: 'untimeout' },
                            { name: '🎭 role-add', value: 'role-add' },
                            { name: '🎭 role-remove', value: 'role-remove' },
                            { name: '🗑️ purge', value: 'purge' },
                            { name: '🔒 lock', value: 'lock' },
                            { name: '🔓 unlock', value: 'unlock' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف اختصار')
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('تعديل اختصار')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض كل الاختصارات')
        ),

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('إعداد سجلات السيرفر')
        ,

    new SlashCommandBuilder()
        .setName('level')
        .setDescription('عرض مستواك أو مستوى عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('level-settings')
        .setDescription('إعداد نظام المستويات')
        
        .addIntegerOption(o =>
            o.setName('messages')
                .setDescription('عدد الرسائل المطلوبة لكل مستوى')
                .setMinValue(1)
                .setRequired(false)
        )
        .addIntegerOption(o =>
            o.setName('level')
                .setDescription('المستوى الذي تعطي عنده رتبة')
                .setMinValue(1)
                .setRequired(false)
        )
        .addRoleOption(o =>
            o.setName('role')
                .setDescription('رتبة المكافأة')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تعيين روم عام للسجلات')
        
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('روم السجلات')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('إعداد الرتبة التلقائية للعضو الجديد')

        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('تحديد رتبة تُعطى تلقائياً لأي عضو جديد')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('الرتبة التي تُعطى عند الدخول')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('إيقاف الرتبة التلقائية')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('حالة الرتبة التلقائية')
        ),

    new SlashCommandBuilder()
        .setName('protect')
        .setDescription('حماية السيرفر (رومات/رتب/باند/بوتات)')

        .addSubcommand(sub =>
            sub.setName('channels')
                .setDescription('حماية الرومات')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('عدد الرومات المسموح')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('roles')
                .setDescription('حماية الرتب')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('عدد الرتب المسموح')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('bans')
                .setDescription('حماية الباند')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('عدد عمليات الحظر')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('bots')
                .setDescription('حماية دخول البوتات')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('webhooks')
                .setDescription('حماية الويب هوك')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('عدد الويب هوك المسموح')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('invites')
                .setDescription('حماية اختصار السيرفر')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('code')
                        .setDescription('الاختصار المراد حمايته (اختصار عادي أو رابط السيرفر المخصص)')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('عرض حالة جميع الحمايات')
        ),

    // ⚠️ ليش فصلنا حمايات المحتوى في أمر لوحدها؟
    // ديسكورد يرفض أي أمر يتجاوز 4000 حرف (APPLICATION_COMMAND_MAX_LENGTH).
    // لو كانت spam + scams جوّا /protect كان الأمر كله 4624 حرف
    // → التسجيل يفشل بالكامل → *ولا أمر* يطلع، حتى السليم منه.
    // فصلناهم في /antispam عشان كل أمر يبقى تحت الحد.
    new SlashCommandBuilder()
        .setName('antispam')
        .setDescription('حماية السبام والخط الكبير + حماية الروم من النصب')
        .addSubcommand(sub =>
            sub.setName('spam')
                .setDescription('حماية السبام والخط الكبير')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('الفترة (ثانية)')
                        .setMinValue(1)
                        .setMaxValue(3600)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('أقصى عدد رسائل')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addIntegerOption(o =>
                    o.setName('maxlength')
                        .setDescription('أقصى طول رسالة')
                        .setMinValue(10)
                        .setMaxValue(2000)
                )
                .addIntegerOption(o =>
                    o.setName('repeated')
                        .setDescription('تكرار الحرف')
                        .setMinValue(3)
                        .setMaxValue(200)
                )
                .addIntegerOption(o =>
                    o.setName('mentions')
                        .setDescription('أقصى عدد منشنات بالرسالة (0 = تعطيل)')
                        .setMinValue(0)
                        .setMaxValue(100)
                )
                .addIntegerOption(o =>
                    o.setName('spaces')
                        .setDescription('أقصى مسافات متتالية (0 = تعطيل)')
                        .setMinValue(0)
                        .setMaxValue(200)
                )
                .addIntegerOption(o =>
                    o.setName('bigtext')
                        .setDescription('أقصى نسبة تكبير خط % (0 = تعطيل)')
                        .setMinValue(0)
                        .setMaxValue(100)
                )
                .addIntegerOption(o =>
                    o.setName('files')
                        .setDescription('أقصى عدد ملفات بالرسالة (0 = تعطيل)')
                        .setMinValue(0)
                        .setMaxValue(20)
                )
                .addBooleanOption(o =>
                    o.setName('links')
                        .setDescription('حظر الروابط الخارجية https')
                )
                .addBooleanOption(o =>
                    o.setName('invites')
                        .setDescription('حظر روابط دعوة السيرفرات')
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('scams')
                .setDescription('حماية الروم من النصب')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم المحمي')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName('clear')
                        .setDescription('تعطيل بدون لمس القواعد')
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName('talk')
                        .setDescription('عقوبة على الكلام')
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName('image')
                        .setDescription('عقوبة على الصور')
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName('link')
                        .setDescription('عقوبة على الروابط')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة')
                        .addChoices(...PROTECTION_ACTIONS)
                        .setRequired(false)
                )
        ),
    
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('🛡️ إدارة الوايت ليست (الحماية تتجاهلها)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة عضو للوايت ليست — الحماية لن تتدخل معه')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('إزالة عضو من الوايت ليست')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض أعضاء الوايت ليست')
        ),
    new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Save everything in this server (channels, roles). Use /restore after a hack.'),
    new SlashCommandBuilder()
        .setName('restore')
        .setDescription('Restore from last backup. OWNER ONLY - recreates deleted channels/roles.'),

    new SlashCommandBuilder()
        .setName('safe-channel')
        .setDescription('🛡️ احمِ روم من الحذف بالتنظيف والاسترجاع')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('أضف روم لقائمة الرومات المحمية')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم المراد حمايته')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('أزل روم من قائمة الرومات المحمية')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('اعرض الرومات المحمية (يدوي + تلقائي)')
        ),

    new SlashCommandBuilder()
        .setName('temprole')
        .setDescription('⏳ إدارة الرتب المؤقتة (أسبوع / شهر / دائم)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('أعطِ عضواً رتبة مؤقتة')
                .addUserOption(o =>
                    o.setName('member')
                        .setDescription('العضو')
                        .setRequired(true)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('الرتبة')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('duration')
                        .setDescription('المدة')
                        .setRequired(true)
                        .addChoices(
                            { name: 'أسبوع', value: 'week' },
                            { name: 'شهر', value: 'month' },
                            { name: 'دائم', value: 'permanent' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('أزل رتبة مؤقتة يدوياً')
                .addUserOption(o =>
                    o.setName('member')
                        .setDescription('العضو')
                        .setRequired(true)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('الرتبة')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('اعرض كل الرتب المؤقتة')
        ),

    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('🎁 إدارة السحوبات')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('حدد روم السحوبات الافتراضي')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم السحوبات')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('ابدأ سحب جديد')
                .addStringOption(o =>
                    o.setName('prize')
                        .setDescription('الجائزة')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('المدة بالدقائق')
                        .setRequired(true)
                        .setMinValue(1)
                )
                .addIntegerOption(o =>
                    o.setName('winners')
                        .setDescription('عدد الفائزين')
                        .setRequired(false)
                        .setMinValue(1)
                )
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم (افتراضي: روم السحوبات)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('شرط رتبة')
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName('require_avatar')
                        .setDescription('شرط صورة بروفايل شخصية (افتراضي نعم)')
                        .setRequired(false)
                )
                .addBooleanOption(o =>
                    o.setName('require_tag')
                        .setDescription('شرط تاق السيرفر (افتراضي نعم)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('أنهِ سحب الآن')
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('ID رسالة السحب')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('reroll')
                .setDescription('أعد اختيار الفائزين')
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('ID رسالة السحب')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('اعرض السحوبات')
        ),

    new SlashCommandBuilder()
        .setName('puzzle')
        .setDescription('🔒 قفل ومفتاح — رمز 4 أرقام والجائزة')
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('أنشئ قفل جديد')
                .addStringOption(o =>
                    o.setName('code')
                        .setDescription('الرمز (4 أرقام)')
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(4)
                )
                .addStringOption(o =>
                    o.setName('prize')
                        .setDescription('الجائزة')
                        .setRequired(true)
                )
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('رتبة تُعطى للفائز (اختياري)')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('hint')
                        .setDescription('تلميح (اختياري)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('end')
                .setDescription('ألغِ قفل نشط')
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('ID رسالة القفل')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('اعرض الأقفال النشطة')
        ),

    new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('🎭 رتب بالإيموجي')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('أنشئ رسالة لوحة لرتب الإيموجي')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('title')
                        .setDescription('عنوان اللوحة')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('description')
                        .setDescription('وصف اللوحة')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('اربط إيموجي برتبة على رسالة')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الرسالة')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('ID الرسالة')
                        .setRequired(true)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('الرتبة')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('emoji')
                        .setDescription('الإيموجي (عادي أو مخصص)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('فك ربط إيموجي')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الرسالة')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('ID الرسالة')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('emoji')
                        .setDescription('الإيموجي')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('اعرض كل الروابط')
        ),

    new SlashCommandBuilder()
        .setName('tempvoice')
        .setDescription('🔊 رومات صوتية مؤقتة')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('حدد روم الانضمام والكاتيجوري')
                .addChannelOption(o =>
                    o.setName('creator_channel')
                        .setDescription('الروم الصوتي اللي تنصنع عنده الرومات')
                        .addChannelTypes(ChannelType.GuildVoice)
                        .setRequired(true)
                )
                .addChannelOption(o =>
                    o.setName('category')
                        .setDescription('الكاتيجوري اللي تنفتح فيه الرومات')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('name_template')
                        .setDescription('قالب الاسم — استخدم {user}')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('أرسل لوحة تحكم الروم الصوتي')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم النصي')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        ),

    new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('💬 نظام الفيدباك')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('حدد روم الفيدباك')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الفيدباك')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('send')
                .setDescription('أرسل ملاحظة / اقتراح')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('اعرض الفيدباك')
        ),

    new SlashCommandBuilder()
        .setName('security-audit')
        .setDescription('🛡️ تقرير أمني شامل (للمالك فقط)'),

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('إدارة نظام التكتات ولوحتها')

        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('تفعيل النظام وتحديد روم اللوحة والكاتقري ورتبة الدعم')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم لوحة التكتات')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addChannelOption(o =>
                    o.setName('category')
                        .setDescription('الكاتقري اللي تنفتح فيه التكتات')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('رتبة الدعم')
                        .setRequired(false)
                )
                .addChannelOption(o =>
                    o.setName('log_channel')
                        .setDescription('روم سجل التكتات')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('message')
                        .setDescription('رسالة اللوحة/الترحيب')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('send')
                .setDescription('نشر رسالة لوحة التكتات بروم (الافتراضي: روم اللوحة)')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم المطلوب النشر فيه')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('option')
                .setDescription('إضافة أو حذف خيار (نوع) للتكتات — تقدر تضيفه مفعّل أو معلق')
                .addStringOption(o =>
                    o.setName('mode')
                        .setDescription('إضافة أو حذف أو تغيير حالة')
                        .addChoices(
                            { name: '➕ إضافة', value: 'add' },
                            { name: '⏸️ تعليق / تفعيل خيار موجود', value: 'state' },
                            { name: '➖ حذف', value: 'remove' }
                        )
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('label')
                        .setDescription('اسم الخيار الظاهر على الزر')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('key')
                        .setDescription('مفتاح الخيار (للحذف أو لتغيير اسم الزر)')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('description')
                        .setDescription('وصف مختصر للخيار')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('emoji')
                        .setDescription('إيموجي الزر')
                        .setRequired(false)
                )
                .addStringOption(o =>
                    o.setName('state')
                        .setDescription('حالة الخيار: مفعّل أو معلق (الافتراضي عند الإضافة: مفعّل)')
                        .addChoices(
                            { name: '✅ مفعّل', value: 'active' },
                            { name: '⏸️ معلق', value: 'suspended' }
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('إيقاف نظام التكتات بالكامل')
        )
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('عرض حالة النظام والخيارات')
        )

        // ===== صورة الإيمبد داخل التكت =====
        .addSubcommandGroup(group =>
            group.setName('image')
                .setDescription('صورة الإيمبد داخل التكت (تظهر عند فتح التكت)')
                .addSubcommand(sub =>
                    sub.setName('set')
                        .setDescription('تعيين صورة الإيمبد برابط أو بمرفق')
                        .addStringOption(o =>
                            o.setName('url')
                                .setDescription('رابط الصورة المباشر (https://...png)')
                                .setRequired(false)
                        )
                        .addAttachmentOption(o =>
                            o.setName('file')
                                .setDescription('أو ارفع الصورة كمرفق')
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('panel')
                        .setDescription('تعيين صورة لوحة التكتات (الرسالة في روم اللوحة)')
                        .addStringOption(o =>
                            o.setName('url')
                                .setDescription('رابط الصورة المباشر')
                                .setRequired(false)
                        )
                        .addAttachmentOption(o =>
                            o.setName('file')
                                .setDescription('أو ارفع الصورة كمرفق')
                                .setRequired(false)
                        )
                )
                .addSubcommand(sub =>
                    sub.setName('remove')
                        .setDescription('حذف كل صور التكتات')
                )
        )

        // ===== إضافة / طرد أشخاص من التكت =====
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة شخص للتكت (يعطيه صلاحية seeing + كتابة)')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('الشخص المراد إضافته')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('طرد شخص من التكت (يلغي صلاحيته)')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('الشخص المراد طرده')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('members')
                .setDescription('عرض كل الأشخاص اللي لهم صلاحية داخل التكت')
        ),

    new SlashCommandBuilder()
        .setName('set-ticket')
        .setDescription('انشر لوحة التكتات في روم (أضف الخيارات من الداشبورد أولاً)')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المطلوب نشر اللوحة فيه')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('تفعيل دخولك للداشبورد بدون آيدي ولا كود')
        .addSubcommand(sub =>
            sub.setName('activate')
                .setDescription('تفعيل حسابك في الداشبورد وأرسال الرابط بالخاص')
        )
        .addSubcommand(sub =>
            sub.setName('login')
                .setDescription('نشر زر "تسجيل الدخول" في روم عشان الأعضاء')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('الروم المطلوب النشر فيه (افتراضي: الروم الحالي)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('حالة حسابك في الداشبورد وسيرفراتك')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('قائمة الحسابات المفعّلة (للمالك فقط)')
        )
        .addSubcommand(sub =>
            sub.setName('revoke')
                .setDescription('إلغاء تفعيل عضو من الداشبورد (للمالك فقط)')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
        ),

].map(command => command.toJSON());

module.exports = { slashCommands, PROTECTION_ACTIONS };
