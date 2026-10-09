// ⏱️ حسابات جدولة النسخ الاحتياطي — منطق صِرف قابل للاختبار
const BACKUP_INTERVAL_MS = 48 * 60 * 60 * 1000;
const BACKUP_CHANGE_DELAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_MAX_DELAY_DAYS = 7;

function dayKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

// أول تشغيل (ما فيه نسخة سابقة)؟
function isFirstRun(state) {
    return !state?.nextBackupAt || !state?.lastBackupAt;
}

// هل حان وقت النسخة؟
function isDue(state, now = Date.now()) {
    if (isFirstRun(state)) return true;
    return now >= new Date(state.nextBackupAt).getTime();
}

// حالة بعد نسخة ناجحة: العدّاد يرجع 48 ساعة
function nextAfterBackup(now = Date.now()) {
    return {
        lastBackupAt: new Date(now),
        nextBackupAt: new Date(now + BACKUP_INTERVAL_MS),
        delayDays: 0,
        changeDay: null
    };
}

// عند تعديل هيكلي: +يوم لكل يوم فيه تعديلات، بحد أقصى 7 أيام
// يرجّع null إذا حسبنا تعديل اليوم من قبل (ما نضاعف)
function nextAfterChange(state, now = Date.now()) {
    const today = dayKey(now);

    if (state?.changeDay === today) return null;

    const delayDays = Math.min(
        (state?.delayDays || 0) + 1,
        BACKUP_MAX_DELAY_DAYS
    );

    // المرساة = آخر نسخة، وإلا الحين
    const anchor = state?.lastBackupAt
        ? new Date(state.lastBackupAt).getTime()
        : now;

    const target =
        anchor + BACKUP_INTERVAL_MS + delayDays * BACKUP_CHANGE_DELAY_MS;

    return {
        lastBackupAt: state?.lastBackupAt || null,
        nextBackupAt: new Date(target),
        delayDays,
        changeDay: today
    };
}

module.exports = {
    BACKUP_INTERVAL_MS,
    BACKUP_CHANGE_DELAY_MS,
    BACKUP_MAX_DELAY_DAYS,
    dayKey,
    isFirstRun,
    isDue,
    nextAfterBackup,
    nextAfterChange
};
