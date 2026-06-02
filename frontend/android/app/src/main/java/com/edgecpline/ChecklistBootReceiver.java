package com.edgecpline;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

public class ChecklistBootReceiver extends BroadcastReceiver {

    private static final String TAG = "ChecklistBootReceiver";

    @Override
    public void onReceive(final Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        // goAsync() tells Android to keep the broadcast alive past onReceive() returning.
        // Without it, Android kills the process after ~10s even if our rescheduling hasn't
        // finished — which silently drops notifications after every reboot on slow devices.
        final PendingResult asyncResult = goAsync();

        new Thread(() -> {
            try {
                Log.d(TAG, "Boot completed — rescheduling checklist notifications");
                for (String market : new String[]{ "Forex", "Indian_Market" }) {
                    SharedPreferences prefs = ChecklistNotificationManager.getPrefs(context, market);
                    if (!prefs.getBoolean(ChecklistNotificationManager.KEY_ENABLED, false)) {
                        Log.d(TAG, "Notifications disabled for " + market + " — skipping");
                        continue;
                    }

                    ChecklistScheduler.scheduleNext(context, prefs, market);
                    Log.d(TAG, "Rescheduled notification for " + market);

                    if (prefs.getBoolean(ChecklistNotificationManager.KEY_RESET_ON, true)) {
                        ChecklistScheduler.scheduleNextReset(context, prefs, market);
                        Log.d(TAG, "Rescheduled reset for " + market);
                    }
                }
                Log.d(TAG, "Boot rescheduling complete");
            } catch (Exception e) {
                Log.e(TAG, "Failed to reschedule notifications on boot: " + e.getMessage(), e);
            } finally {
                // MUST always call finish() — otherwise Android holds a wakelock indefinitely.
                asyncResult.finish();
            }
        }).start();
    }
}
