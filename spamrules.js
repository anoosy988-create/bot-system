'use strict';

// ======================================================
// 🧩 spamrules.js — كاشفات السبام (دوال نقية قابلة للاختبار)
// تُستخدم من handleSpam في index.js. لا تعتمد على discord.js
// ولا على القاعدة، فقط نص وعدادات.
// ======================================================

// روابط دعوة سيرفرات ديسكورد
const INVITE_RE = /(?:discord\.(?:gg|com\/invite)\/|discordapp\.com\/invite\/)[A-Za-z0-9-]+/i;

// أي رابط خارجي http/https
const URL_RE = /https?:\/\/[^\s<>"']+/i;

// نطاقات "تكبير الخط" (Unicode): كامل العرض + حروف رياضية + مرتفعة + محاطة
const BIG_TEXT_RE = /[\uFF01-\uFF5E\u2460-\u24FF\u2070-\u209F\u1D00-\u1D7F]|[\u{1D400}-\u{1D7FF}]/gu;

// أي نوع مسافة/فراغ (عادي + NBSP + رقيق + كامل العرض)
const SPACE_RUN_RE = /[ \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;

// الحدود الافتراضية
const DEFAULTS = {
    maxMentions: 6,
    maxSpaces: 10,
    maxBigText: 60,
    maxFiles: 4
};

// نسبة أحرف "الخط الكبير" من إجمالي الأحرف غير الفارغة
function bigCharRatio(text) {
    const t = String(text || '');
    const big = (t.match(BIG_TEXT_RE) || []).length;
    if (!big) return 0;
    const letters = (t.match(/\S/g) || []).length;
    return letters ? big / letters : 0;
}

// أطول سلسلة مسافات متتالية
function maxSpaceRun(text) {
    let max = 0;
    const t = String(text || '');
    let m;
    SPACE_RUN_RE.lastIndex = 0;
    while ((m = SPACE_RUN_RE.exec(t)) !== null) {
        if (m[0].length > max) max = m[0].length;
    }
    return max;
}

// يحلل رسالة ويرجّع قائمة المخالفات: [{ metric, reason }]
function detect(message, spam) {
    const cfg = spam || {};
    const content = message?.content || '';
    const out = [];

    const mentionCount =
        (message?.mentions?.users?.size || 0) +
        (message?.mentions?.roles?.size || 0);
    const everyone = Boolean(message?.mentions?.everyone);
    const attachmentCount = message?.attachments?.size || 0;

    // منشنات كثيرة أو everyone/here
    if (cfg.onMentions !== false) {
        const maxM = cfg.maxMentions || DEFAULTS.maxMentions;
        if (mentionCount >= maxM || (everyone && mentionCount >= 1)) {
            out.push({
                metric: 'mentions',
                reason: `منشنات كثيرة (${mentionCount}${everyone ? ' + everyone' : ''})`
            });
        }
    }

    // مسافات كثيرة
    if (cfg.onSpaces !== false) {
        const run = maxSpaceRun(content);
        const maxS = cfg.maxSpaces || DEFAULTS.maxSpaces;
        if (run >= maxS) {
            out.push({ metric: 'spaces', reason: `مسافات كثيرة (${run})` });
        }
    }

    // تكبير الخط
    if (cfg.onBigText !== false) {
        const ratio = bigCharRatio(content);
        const limit = cfg.maxBigText || DEFAULTS.maxBigText;
        const letters = content.replace(/\s/g, '').length;
        if (letters >= 4 && ratio * 100 >= limit) {
            out.push({
                metric: 'bigtext',
                reason: `تكبير خط (${Math.round(ratio * 100)}%)`
            });
        }
    }

    // ملفات كثيرة
    if (cfg.onFiles !== false) {
        const maxF = cfg.maxFiles || DEFAULTS.maxFiles;
        if (attachmentCount >= maxF) {
            out.push({ metric: 'files', reason: `ملفات كثيرة (${attachmentCount})` });
        }
    }

    // روابط خارجية https
    if (cfg.onLinks && URL_RE.test(content)) {
        out.push({ metric: 'links', reason: 'رابط خارجي' });
    }

    // روابط دعوة سيرفرات
    if (cfg.onInvites && INVITE_RE.test(content)) {
        out.push({ metric: 'invites', reason: 'رابط دعوة سيرفر' });
    }

    return out;
}

module.exports = {
    detect,
    bigCharRatio,
    maxSpaceRun,
    INVITE_RE,
    URL_RE,
    DEFAULTS
};
