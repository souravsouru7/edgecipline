package com.edgecpline;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class ChecklistBootReceiver extends BroadcastReceiver {

    private static final String TAG = "ChecklistBootReceiver";

    @Override
    public void onReceive(final Context context, Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }

        final PendingResult asyncResult = goAsync();

        new Thread(() -> {
            try {
                Log.d(TAG, action + " received - rescheduling checklist notifications");
                ChecklistScheduler.rescheduleAll(context);
                Log.d(TAG, "Checklist rescheduling complete");
            } catch (Exception e) {
                Log.e(TAG, "Failed to reschedule checklist notifications", e);
            } finally {
                asyncResult.finish();
            }
        }).start();
    }
}
