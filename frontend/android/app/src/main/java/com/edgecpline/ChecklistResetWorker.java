package com.edgecpline;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class ChecklistResetWorker extends Worker {

    public static final String TAG = "checklist_reset";

    public ChecklistResetWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        String market = ChecklistScheduler.normalizeMarket(getInputData().getString("market"));
        SharedPreferences prefs = null;

        try {
            prefs = ChecklistNotificationManager.getPrefs(ctx, market);

            if (!prefs.getBoolean(ChecklistNotificationManager.KEY_ENABLED, false)) {
                Log.d(TAG, "Notifications disabled for " + market);
                return Result.success();
            }
            if (!prefs.getBoolean(ChecklistNotificationManager.KEY_RESET_ON, true)) {
                Log.d(TAG, "Checklist reset disabled for " + market);
                return Result.success();
            }

            ChecklistNotificationManager.resetItems(ctx, market);
            String error = ChecklistNotificationManager.showOrUpdate(ctx, market);
            if (error != null) {
                Log.w(TAG, "showOrUpdate after reset returned: " + error);
            }
        } catch (Throwable error) {
            Log.e(TAG, "Checklist reset failed", error);
        } finally {
            try {
                if (prefs == null) {
                    prefs = ChecklistNotificationManager.getPrefs(ctx, market);
                }
                ChecklistScheduler.scheduleNextReset(ctx, prefs, market);
            } catch (Throwable error) {
                Log.e(TAG, "Failed to schedule next checklist reset", error);
                try {
                    ChecklistScheduler.rescheduleAll(ctx);
                } catch (Throwable fallbackError) {
                    Log.e(TAG, "Fallback checklist reschedule failed", fallbackError);
                }
            }
        }

        return Result.success();
    }
}
