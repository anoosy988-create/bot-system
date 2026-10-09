const {
    EmbedBuilder,
    PermissionsBitField
} = require('discord.js');

// ======================================================
// SECURITY AUDIT — تقرير أمني للمالك (قراءة فقط)
// ======================================================

let deps = {};

function init(d) {
    deps = d || {};
}

function isOwner(interaction) {
    try {
        if (deps.OWNER_ID && interaction.user.id === deps.OWNER_ID) return true;
        return interaction.user.id === interaction.guild.ownerId;
    } catch {
        return false;
    }
}

function flag(guild, name) {
    const perms = guild.members.me?.permissions;
    return perms?.has(name) ? '✅' : '❌';
}

async function buildReport(guild) {
    const settings = deps.getSettings ? await deps.getSettings(guild.id).catch(() => null) : null;
    if (settings && deps.ensureProtections) deps.ensureProtections(settings);

    const prot = settings?.protections || {};
    const onOff = v => (v ? '✅' : '❌');

    // ---- الحماية ----
    const protLines = [
        `قنوات: ${onOff(prot.channels?.enabled)}`,
        `رتب: ${onOff(prot.roles?.enabled)}`,
        `باند: ${onOff(prot.ban?.enabled)}`,
        `بوتات: ${onOff(prot.bots?.enabled)}`,
        `سبام: ${onOff(prot.spam?.enabled)}`,
        `ويب هوك: ${onOff(prot.webhooks?.enabled)}`,
        `إنفايت: ${onOff(prot.invites?.enabled)}`
    ].join(' · ');

    // ---- صلاحيات البوت ----
    const permsLines = [
        `ViewAuditLog ${flag(guild, PermissionsBitField.Flags.ViewAuditLog)}`,
        `ManageChannels ${flag(guild, PermissionsBitField.Flags.ManageChannels)}`,
        `ManageRoles ${flag(guild, PermissionsBitField.Flags.ManageRoles)}`,
        `ManageWebhooks ${flag(guild, PermissionsBitField.Flags.ManageWebhooks)}`,
        `ManageMessages ${flag(guild, PermissionsBitField.Flags.ManageMessages)}`,
        `BanMembers ${flag(guild, PermissionsBitField.Flags.BanMembers)}`,
        `KickMembers ${flag(guild, PermissionsBitField.Flags.KickMembers)}`
    ].join('\n');

    // ---- رتب بصلاحيات خطيرة ----
    const dangerous = guild.roles.cache
        .filter(r => !r.managed && r.id !== guild.id && r.permissions.has(PermissionsBitField.Flags.Administrator))
        .map(r => r.name);

    const dangerLine = dangerous.length
        ? dangerous.slice(0, 20).map(n => `⚠️ ${n}`).join('\n')
        : '✅ ما فيه رتب (غير مُدارة) بصلاحية Administrator';

    // ---- الإعدادات ----
    const cfgLines = [
        `رتبة الإدارة: **${deps.STAFF_ROLE_NAME || '—'}**`,
        `وايت ليست: **${(settings?.whitelist || []).length}** عضو`,
        `رومات محمية: **${(settings?.protectedChannelIds || []).length}** يدوي`,
        `روم التكت: ${settings?.tickets?.panelChannelId ? `<#${settings.tickets.panelChannelId}>` : '—'}`,
        `روم الفيدباك: ${settings?.feedbackChannelId ? `<#${settings.feedbackChannelId}>` : '—'}`,
        `روم السحوبات: ${settings?.giveawayChannelId ? `<#${settings.giveawayChannelId}>` : '—'}`,
        `روم الصوتيات: ${settings?.voice?.creatorChannelId ? `<#${settings.voice.creatorChannelId}>` : '—'}`
    ].join('\n');

    // ---- النسخ الاحتياطي ----
    const compact = ts => (ts ? `<t:${Math.floor(new Date(ts).getTime() / 1000)}:R>` : '—');
    let backupCount = 0;
    try {
        if (deps.GuildBackupHistory) {
            backupCount = await deps.GuildBackupHistory.countDocuments({ guildId: guild.id });
        }
    } catch {}

    const backupLines = [
        `آخر نسخة: ${compact(settings?.backupState?.lastBackupAt)}`,
        `النسخة الجاية: ${compact(settings?.backupState?.nextBackupAt)}`,
        `تأخير متراكم: **${settings?.backupState?.delayDays || 0}** يوم`,
        `عدد النسخ المحفوظة: **${backupCount}**`
    ].join('\n');

    // ---- أمن السيرفر ----
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const securityLines = [
        `التحقق: **${guild.verificationLevel}**`,
        `2FA للإدارة: **${guild.mfaLevel === 1 ? '✅ مطلوب' : '❌ غير مطلوب'}**`,
        `عدد البوتات: **${bots}**`,
        `الاختصار (Vanity): **${guild.vanityURLCode ? 'discord.gg/' + guild.vanityURLCode : 'لا يوجد'}**`,
        `عدد الرومات: **${guild.channels.cache.size}** · الرتب: **${guild.roles.cache.size}**`
    ].join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🛡️ تقرير أمني — ${guild.name}`)
        .setColor(0x5865F2)
        .setTimestamp(new Date())
        .addFields(
            { name: '🔐 الحماية', value: protLines, inline: false },
            { name: '🤖 صلاحيات البوت', value: permsLines, inline: false },
            { name: '⚠️ رتب Administrator', value: dangerLine.slice(0, 1024), inline: false },
            { name: '⚙️ الإعدادات', value: cfgLines.slice(0, 1024), inline: false },
            { name: '📦 النسخ الاحتياطي', value: backupLines, inline: false },
            { name: '🔒 أمن السيرفر', value: securityLines, inline: false }
        )
        .setFooter({ text: 'قراءة فقط — هذي صورة عن الوضع الحالي' });

    return embed;
}

async function handleSlash(interaction) {
    if (!isOwner(interaction)) {
        return interaction.reply({
            content: '❌ هذا التقرير للمالك فقط.',
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        const embed = await buildReport(interaction.guild);
        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        return interaction.editReply({
            content: `❌ فشل بناء التقرير: ${error.message}`
        });
    }
}

module.exports = {
    init,
    handleSlash,
    buildReport
};
