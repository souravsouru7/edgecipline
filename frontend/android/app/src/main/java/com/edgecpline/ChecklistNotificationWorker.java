package com.edgecpline;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.Calendar;

/**
 * Daily checklist reminder worker.
 *
 * Reliability contract — the next reminder MUST always be scheduled, even if:
 *   - showOrUpdate() throws
 *   - SharedPreferences read throws
 *   - NotificationManagerCompat throws
 *   - Any Android system service is temporarily unavailable
 *
 * Never returns Result.failure() for notification display errors — that would
 * stop WorkManager from rescheduling and silently kill the reminder chain.
 */
public class ChecklistNotificationWorker extends Worker {

    public static final String TAG = "checklist_notification";
    private static final String LOG_TAG = "ChecklistWorker";

    public ChecklistNotificationWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        final Context ctx = getApplicationContext();
        final String market = ChecklistScheduler.normalizeMarket(getInputData().getString("market"));
        final long startedAt = System.currentTimeMillis();

        Log.i(LOG_TAG, "WORKER_START market=" + market + " at=" + startedAt);

        SharedPreferences prefs = null;
        boolean displayed = false;
        String displayError = null;

        try {
            prefs = ChecklistNotificationManager.getPrefs(ctx, market);

            if (!prefs.getBoolean(ChecklistNotificationManager.KEY_ENABLED, false)) {
                Log.i(LOG_TAG, "WORKER_SKIP reason=disabled market=" + market);
            } else if (!shouldRunToday(prefs)) {
                Log.i(LOG_TAG, "WORKER_SKIP reason=repeat_settings market=" + market);
            } else {
                Log.d(LOG_TAG, "Attempting notification market=" + market);
                String error = ChecklistNotificationManager.showOrUpdate(ctx, market);
                if (error == null) {
                    displayed = true;
                    Log.d(LOG_TAG, "CHECKLIST_NOTIFICATION_SHOWN market=" + market);
                    Log.i(LOG_TAG, "WORKER_SUCCESS market=" + market
                            + " durationMs=" + (System.currentTimeMillis() - startedAt));
                } else {
                    displayError = error;
                    Log.e(LOG_TAG, "WORKER_ERROR phase=display market=" + market + " error=" + error);
                }
            }
        } catch (Throwable displayThrowable) {
            // Catch Throwable, not just Exception — even OOM/StackOverflow must
            // not prevent rescheduling. Log and continue to the finally block.
            displayError = displayThrowable.getMessage();
            Log.e(LOG_TAG, "WORKER_ERROR phase=display market=" + market
                    + " threw=" + displayThrowable.getClass().getSimpleName(), displayThrowable);
        } finally {
            // RESCHEDULE GUARANTEE. This block must never throw.
            try {
                if (prefs == null) {
                    try {
                        prefs = ChecklistNotificationManager.getPrefs(ctx, market);
                    } catch (Throwable prefsThrowable) {
                        Log.e(LOG_TAG, "WORKER_ERROR phase=prefs_refetch market=" + market,
                                prefsThrowable);
                    }
                }

                if (prefs != null) {
                    ChecklistScheduler.scheduleNext(ctx, prefs, market);
                    Log.i(LOG_TAG, "WORKER_RESCHEDULED market=" + market
                            + " displayed=" + displayed
                            + " displayError=" + (displayError == null ? "none" : displayError));
                } else {
                    // Last resort — fall back to a default reschedule with no prefs.
                    // This won't honour user settings but keeps the chain alive
                    // until the next successful run can read prefs.
                    try {
                        ChecklistScheduler.rescheduleAll(ctx);
                        Log.w(LOG_TAG, "WORKER_RESCHEDULED phase=fallback market=" + market);
                    } catch (Throwable fallbackThrowable) {
                        Log.e(LOG_TAG, "WORKER_ERROR phase=fallback_reschedule market=" + market,
                                fallbackThrowable);
                    }
                }
            } catch (Throwable rescheduleThrowable) {
                Log.e(LOG_TAG, "WORKER_ERROR phase=reschedule market=" + market
                        + " threw=" + rescheduleThrowable.getClass().getSimpleName(),
                        rescheduleThrowable);
            }
        }

        // Always success — Result.failure() would tell WorkManager to stop
        // scheduling this work chain, permanently killing the reminders.
        return Result.success();
    }

    private boolean shouldRunToday(SharedPreferences prefs) {
        try {
            String mode = prefs.getString(ChecklistNotificationManager.KEY_REPEAT, "daily");
            if ("daily".equals(mode)) return true;

            int calDay = Calendar.getInstance().get(Calendar.DAY_OF_WEEK);
            int ourDay = calDay == Calendar.SUNDAY ? 7 : calDay - 1;

            if ("weekdays".equals(mode)) {
                return ourDay >= 1 && ourDay <= 5;
            }

            String customDays = prefs.getString(ChecklistNotificationManager.KEY_CUSTOM_DAYS, "1,2,3,4,5");
            for (String d : customDays.split(",")) {
                try {
                    if (Integer.parseInt(d.trim()) == ourDay) return true;
                } catch (NumberFormatException ignored) {
                }
            }
            return false;
        } catch (Throwable t) {
            // If prefs read throws, default to running so the user still gets
            // a reminder rather than silently being skipped.
            Log.e(LOG_TAG, "WORKER_ERROR phase=should_run_today threw=" + t.getClass().getSimpleName(), t);
            return true;
        }
    }
}
