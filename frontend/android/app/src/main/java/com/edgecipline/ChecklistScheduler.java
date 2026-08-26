package com.edgecipline;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;

import java.util.Calendar;
import java.util.concurrent.TimeUnit;

public class ChecklistScheduler {
    private static final String TAG = "ChecklistScheduler";
    public static final String MARKET_FOREX = "Forex";
    public static final String MARKET_INDIAN = "Indian_Market";

    // ── Work name helpers ─────────────────────────────────────────────────

    public static String getNotificationWorkName(String market) {
        return MARKET_INDIAN.equals(normalizeMarket(market))
                ? "checklist_notification_indian"
                : "checklist_notification_forex";
    }

    public static String getResetWorkName(String market) {
        return MARKET_INDIAN.equals(normalizeMarket(market))
                ? "checklist_reset_indian"
                : "checklist_reset_forex";
    }

    public static String normalizeMarket(String market) {
        if (market == null) {
            Log.w(TAG, "Market missing; defaulting to Forex");
            return MARKET_FOREX;
        }

        if (MARKET_FOREX.equals(market) || MARKET_INDIAN.equals(market)) {
            return market;
        }

        Log.w(TAG, "Invalid market '" + market + "'; defaulting to Forex");
        return MARKET_FOREX;
    }

    // ── Schedule ──────────────────────────────────────────────────────────

    public static void scheduleNext(Context ctx, SharedPreferences prefs, String market) {
        market = normalizeMarket(market);
        if (prefs == null) {
            prefs = ChecklistNotificationManager.getPrefs(ctx, market);
        }

        String time = "09:00";
        try {
            time = prefs.getString(ChecklistNotificationManager.KEY_TIME, "09:00");
        } catch (Exception e) {
            Log.w(TAG, "Failed to read notification time; using default 09:00", e);
        }
        long delayMs = millisUntilNextTime(time);

        Data inputData = new Data.Builder()
                .putString("market", market)
                .build();

        OneTimeWorkRequest req;
        try {
            req = new OneTimeWorkRequest.Builder(ChecklistNotificationWorker.class)
                    .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .setInputData(inputData)
                    .addTag(getNotificationWorkName(market))
                    .build();
            Log.d(TAG, "Expedited work scheduled");
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "Expedited delayed work rejected; scheduling non-expedited fallback", e);
            req = new OneTimeWorkRequest.Builder(ChecklistNotificationWorker.class)
                    .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                    .setInputData(inputData)
                    .addTag(getNotificationWorkName(market))
                    .build();
        }

        WorkManager.getInstance(ctx).enqueueUniqueWork(
                getNotificationWorkName(market),
                ExistingWorkPolicy.REPLACE,
                req
        );

        scheduleExactAlarm(ctx, market, delayMs);
    }

    /** Backward-compat overload — defaults to Forex. */
    public static void scheduleNext(Context ctx, SharedPreferences prefs) {
        scheduleNext(ctx, prefs, MARKET_FOREX);
    }

    public static void scheduleNextReset(Context ctx, SharedPreferences prefs, String market) {
        market = normalizeMarket(market);
        if (prefs == null) {
            prefs = ChecklistNotificationManager.getPrefs(ctx, market);
        }

        String time = "00:00";
        try {
            time = prefs.getString(ChecklistNotificationManager.KEY_RESET_TIME, "00:00");
        } catch (Exception e) {
            Log.w(TAG, "Failed to read reset time; using default 00:00", e);
        }
        long delayMs = millisUntilNextTime(time);

        Data inputData = new Data.Builder()
                .putString("market", market)
                .build();

        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(ChecklistResetWorker.class)
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setInputData(inputData)
                .addTag(getResetWorkName(market))
                .build();

        WorkManager.getInstance(ctx).enqueueUniqueWork(
                getResetWorkName(market),
                ExistingWorkPolicy.REPLACE,
                req
        );
    }

    /** Backward-compat overload — defaults to Forex. */
    public static void scheduleNextReset(Context ctx, SharedPreferences prefs) {
        scheduleNextReset(ctx, prefs, MARKET_FOREX);
    }

    /** Cancel scheduled work for a specific market. */
    public static void cancelAll(Context ctx, String market) {
        market = normalizeMarket(market);
        WorkManager wm = WorkManager.getInstance(ctx);
        wm.cancelUniqueWork(getNotificationWorkName(market));
        wm.cancelUniqueWork(getResetWorkName(market));
        cancelExactAlarm(ctx, market);
    }

    /** Cancel scheduled work for all markets. */
    public static void cancelAll(Context ctx) {
        cancelAll(ctx, MARKET_FOREX);
        cancelAll(ctx, MARKET_INDIAN);
    }

    /** Restore recurring checklist work after reboot or app update. */
    public static void rescheduleAll(Context ctx) {
        for (String market : new String[]{ MARKET_FOREX, MARKET_INDIAN }) {
            try {
                SharedPreferences prefs = ChecklistNotificationManager.getPrefs(ctx, market);
                if (!prefs.getBoolean(ChecklistNotificationManager.KEY_ENABLED, false)) {
                    Log.d(TAG, "Notifications disabled for " + market + " - skipping");
                    continue;
                }

                scheduleNext(ctx, prefs, market);
                Log.d(TAG, "Rescheduled notification for " + market);

                if (prefs.getBoolean(ChecklistNotificationManager.KEY_RESET_ON, true)) {
                    scheduleNextReset(ctx, prefs, market);
                    Log.d(TAG, "Rescheduled reset for " + market);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to reschedule checklist work for " + market, e);
            }
        }
    }

    /**
     * Returns milliseconds until the next occurrence of "HH:mm".
     * If that time has already passed today, schedules for tomorrow.
     */
    static long millisUntilNextTime(String hhMm) {
        int hour   = 9;
        int minute = 0;
        try {
            String[] parts = hhMm.split(":");
            hour   = Integer.parseInt(parts[0]);
            minute = Integer.parseInt(parts[1]);
        } catch (Exception ignored) {}

        Calendar target = Calendar.getInstance();
        target.set(Calendar.HOUR_OF_DAY, hour);
        target.set(Calendar.MINUTE,      minute);
        target.set(Calendar.SECOND,      0);
        target.set(Calendar.MILLISECOND, 0);

        long now = System.currentTimeMillis();
        if (target.getTimeInMillis() <= now) {
            target.add(Calendar.DAY_OF_YEAR, 1);
        }
        return target.getTimeInMillis() - now;
    }

    private static int getAlarmRequestCode(String market) {
        return MARKET_INDIAN.equals(normalizeMarket(market)) ? 7302 : 7301;
    }

    private static PendingIntent getAlarmIntent(Context ctx, String market, int flags) {
        Intent intent = new Intent(ctx, ChecklistAlarmReceiver.class);
        intent.setAction(getNotificationWorkName(market));
        intent.putExtra("market", market);
        return PendingIntent.getBroadcast(ctx, getAlarmRequestCode(market), intent, flags);
    }

    private static void scheduleExactAlarm(Context ctx, String market, long delayMs) {
        try {
            AlarmManager alarmManager = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) {
                Log.w(TAG, "AlarmManager unavailable; WorkManager fallback remains scheduled");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
                Log.w(TAG, "Exact alarm permission unavailable; WorkManager fallback remains scheduled");
                return;
            }

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent pendingIntent = getAlarmIntent(ctx, market, flags);
            long triggerAtMs = System.currentTimeMillis() + Math.max(0, delayMs);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent);
            }
            Log.d(TAG, "Exact alarm scheduled for checklist reminder");
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule exact alarm; WorkManager fallback remains scheduled", e);
        }
    }

    private static void cancelExactAlarm(Context ctx, String market) {
        try {
            AlarmManager alarmManager = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager == null) return;

            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }

            alarmManager.cancel(getAlarmIntent(ctx, market, flags));
            Log.d(TAG, "Exact alarm cancelled for " + market);
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel exact alarm for " + market, e);
        }
    }
}
