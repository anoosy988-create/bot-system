// تشغيل الداشبورد محلياً للتجربة — بدون ربط البوت بديسكورد
// (ما فيه bot gateway، فما يتعارض مع نسختك على Wispbyte)
//
// تشغيل:  node tools/local-dashboard.js
// ثم افتح: http://localhost:3899
//
// ⚠️ لازم تضيف redirect محلي في Discord Developer Portal (مرة وحدة):
//    http://localhost:3899/api/auth/callback

// ⚠️ لازم .env ينقرأ **قبل** ما نتحقق من القيم، وإلا رح نكتب '' فوق الموجود
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

process.env.PORT = '3899';
process.env.CLIENT_ID = process.env.CLIENT_ID || process.env.DASHBOARD_CLIENT_ID || '1533239633281028207';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'local-test-secret';

if (!process.env.CLIENT_SECRET && !process.env.DASHBOARD_CLIENT_SECRET) {
    console.error(
        '\n❌ ما في CLIENT_SECRET بـ .env — ما رح يشتغل تسجيل الدخول.\n' +
        '   ضفه من Discord Developer Portal > OAuth2 > General > Client Secret\n'
    );
    process.exit(1);
}

const express = require('express');
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, AttachmentBuilder, PermissionsBitField
} = require('discord.js');

const setupDashboard = require('../dashboard/server.js');

const app = express();
app.set('trust proxy', true);

// ── client وهمي: مفيش سيرفرات، فأي حساب بيشوف رسالة "ما عندك سيرفرات"
//    هذا بالضبط اللي بدك تجربه.
const client = {
    guilds: { cache: new Map() },
    user: {
        id: '1533239633281028207',
        username: 'Cypher Security',
        tag: 'Cypher Security#8481',
        avatar: null
    },
    isReady: () => true,
    readyTimestamp: Date.now() - 60000,
    uptime: 60000,
    ws: { ping: 30, status: 0 },
    userManager: { resolve: async () => null }
};

function fakeSettings() {
    return {
        guildId: '0',
        welcome: { enabled: true, channelId: null, message: 'أهلاً', image: '' },
        tickets: {
            enabled: false, panelChannelId: null, categoryId: null,
            logChannelId: null, supportRoleId: null, image: '', options: []
        },
        protections: {},
        toObject() { return { welcome: this.welcome, tickets: this.tickets, protections: this.protections }; },
        save: async () => this
    };
}

const deps = {
    client,
    GuildSettings: { findOne: async () => fakeSettings() },
    getSettings: async () => fakeSettings(),
    ensureProtections: () => {},
    sendLog: async () => {},
    jailMember: async () => {},
    unjailMember: async () => {},
    isServerAdmin: () => true,
    memberHasStaffRole: () => true,
    hasStaffAccess: () => true,
    hasDashboardAccess: () => true,
    DashboardUser: { findOne: async () => null },
    DashboardLog: {
        find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })
    },
    STAFF_ROLE_NAME: process.env.STAFF_ROLE_NAME || 'ستريتر',
    OWNER_ID: '1364275261398581279',
    normalizeText: (s) => String(s || '').trim().toLowerCase(),
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, AttachmentBuilder, PermissionsBitField
};

setupDashboard(app, deps);

app.get('/healthz', (req, res) => res.json({ ok: true, local: true }));

app.listen(3899, '127.0.0.1', () => {
    console.log('\n==============================================');
    console.log('  الداشبورد شغال محلياً');
    console.log('==============================================');
    console.log('  افتح:  http://localhost:3899');
    console.log('\n  ⚠️ لو زر الدخول أعطاك خطأ من Discord،');
    console.log('     ضف هذا الرابط بـ OAuth2 > Redirects:');
    console.log('     http://localhost:3899/api/auth/callback');
    console.log('\n  ملاحظة: ما في سيرفرات مسجّلة بالمحلي،');
    console.log('  فأي حساب بيدخل رح يشوف رسالة');
    console.log('  "ما عندك أي سيرفر تقدر تديره".');
    console.log('==============================================\n');
});
