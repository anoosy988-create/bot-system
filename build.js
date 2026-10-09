// حزمة رفع جاهزة للاستضافة — تمنع نفس أخطاء الرفع اللي来抓 متكرر
//
// المشكلة اللي كانت تحصل: index.js يُرفع لحاله، ومجلد dashboard/ لا يُرفع.
// النتيجة: Error: Cannot find module './dashboard/server.js' → البوت كله يموت.
//
// هذا السكربت يبني ZIP فيه **كل** ملفات المشروع المطلوبة مع الداشبورد،
// ويشيل الملفات الحسّاسة (.env) ويضعها في .env.example بدالها.
//
// الاستخدام:  node build.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_ZIP = path.join(OUT_DIR, 'bot.zip');

// اللي ما ينرفع أبداً
const EXCLUDE_NAMES = new Set([
    'node_modules',
    '.git',
    'dist',
    '.cache',
    '.backup',
    'logs',
    'tools',      // اختبارات التطوير — ما يحتاجها البوت على الاستضافة
    '.commands-hash', // بصمة محلية تُنشأ وقت التشغيل — لا تُنقل للحزمة
    'Thumbs.db',
    'desktop.ini',
    '.DS_Store'
]);

const EXCLUDE_EXT = ['.log', '.zip', '.bak', '.tmp'];

// ملفات نضعها بدل originals (النسخة الآمنة)
const REDACT = new Set(['.env']);

let included = 0;
let redacted = 0;
let skipped = 0;

function walk(dir, outDir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = entry.name;

        if (EXCLUDE_NAMES.has(name)) { skipped++; continue; }
        if (EXCLUDE_EXT.some(ext => name.toLowerCase().endsWith(ext))) { skipped++; continue; }

        const full = path.join(dir, name);
        const rel = path.relative(ROOT, full);

        if (entry.isDirectory()) {
            walk(full, path.join(outDir, name));
            continue;
        }

        if (!entry.isFile()) { skipped++; continue; }

        fs.mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });

        if (REDACT.has(name)) {
            // .env -> .env.example بدون القيم
            const safe = fs
                .readFileSync(full, 'utf8')
                .split(/\r?\n/)
                .map(line => {
                    if (!line.trim() || line.trim().startsWith('#')) return line;
                    const eq = line.indexOf('=');
                    if (eq === -1) return line;
                    const key = line.slice(0, eq).trim();
                    return `${key}=`;
                })
                .join('\n');

            fs.writeFileSync(
                path.join(outDir, name.replace(/^\.env$/, '.env.example')),
                safe,
                'utf8'
            );

            redacted++;
            console.log('  🔒 ' + rel + '  ->  ' + name.replace(/^\.env$/, '.env.example') + ' (بدون المفاتيح)');
            continue;
        }

        fs.copyFileSync(full, path.join(outDir, name));
        included++;
    }
}

function verifyStage(stageDir) {
    const problems = [];

    // 🚨 الفحص الأهم: أي ملف يطلبه index.js لازم يكون موجود
    const REQUIRED = [
        ['index.js', 'ملف البوت الرئيسي'],
        ['package.json', 'إعدادات الحزم'],
        ['commands.js', 'تعريفات أوامر Slash'],
        ['tickets.js', 'نظام التكتات'],
        ['dashboard/server.js', 'سيرفر الداشبورد'],
        ['dashboard/public/index.html', 'صفحة الداشبورد'],
        ['dashboard/public/app.js', 'منطق الداشبورد'],
        ['dashboard/public/style.css', 'تصميم الداشبورد']
    ];

    for (const [rel, why] of REQUIRED) {
        if (!fs.existsSync(path.join(stageDir, rel))) {
            problems.push('ناقص: ' + rel + '  (' + why + ')');
        }
    }

    // ما نرفعش الأسرار
    if (fs.existsSync(path.join(stageDir, '.env'))) {
        problems.push('الملف .env موجود بالحزمة — هذا تسريب! لازم يكون .env.example');
    }

    return problems;
}

function readPkg() {
    try {
        return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    } catch {
        return {};
    }
}

function main() {
    console.log('📦 بناء حزمة الرفع...\n');

    // تنظيف
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    const stage = path.join(OUT_DIR, '_stage');
    fs.mkdirSync(stage, { recursive: true });

    walk(ROOT, stage);

    console.log('\n  ملفات: ' + included + '  |  محمي: ' + redacted + '  |  متجاوز: ' + skipped);

    const problems = verifyStage(stage);
    if (problems.length) {
        console.error('\n🚨 الحزمة ناقصة — لا ترفعها:\n');
        problems.forEach(p => console.error('   - ' + p));
        process.exit(1);
    }

    console.log('\n✅ الفحص نجح: كل ملفات الداشبورد موجودة داخل الحزمة.');

    // نضغط
    fs.rmSync(OUT_ZIP, { force: true });

    // بنستخدم tar (موجود على ويندوز 10+ ولينكس/ماك) — zip بدون أي dependency
    try {
        execFileSync(
            'tar',
            ['-a', '-c', '-f', OUT_ZIP, '-C', stage, '.'],
            { stdio: 'inherit' }
        );
    } catch {
        console.error('\n❌ فشل الضغط — تأكد إن أمر tar متاح عندك.');
        console.error('   بديل: انسخ مجلد dist/_stage كله لمجلد /home/container مباشرة.');
        process.exit(1);
    }

    fs.rmSync(stage, { recursive: true, force: true });

    const sizeKb = Math.round(fs.statSync(OUT_ZIP).size / 1024);
    const pkg = readPkg();

    console.log('\n==============================================');
    console.log('  الحزمة جاهزة: dist/bot.zip  (' + sizeKb + ' KB)');
    console.log('==============================================\n');
    console.log('  الرفع:');
    console.log('   1) ادخل /home/container في File Manager');
    console.log('   2) احذف أي ملفات قديمة (index.js القديم)');
    console.log('   3) ارفع bot.zip وفكّه **داخل /home/container مباشرة**');
    console.log('      لازم يصير:');
    console.log('        /home/container/index.js');
    console.log('        /home/container/package.json');
    console.log('        /home/container/dashboard/server.js');
    console.log('        /home/container/dashboard/public/index.html');
    console.log('   4) ارفع .env يدوياً (ما هو موجود بالحزمة — لأنه فيه مفاتيحك)');
    console.log('   5) JS_FILE = ' + (pkg.main || 'index.js'));
    console.log('\n  ⚠️ لا تفك الضغط داخل مجلد فرعي، ولا تكتب .env على GitHub.\n');
}

main();
