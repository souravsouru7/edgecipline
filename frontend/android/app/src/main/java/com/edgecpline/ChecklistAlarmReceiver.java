package com.edgecpline;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;

public class ChecklistAlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "ChecklistAlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String market = ChecklistScheduler.normalizeMarket(intent.getStringExtra("market"));

        Data inputData = new Data.Builder()
                .putString("market", market)
                .build();

        OneTimeWorkRequest req;
        try {
            req = new OneTimeWorkRequest.Builder(ChecklistNotificationWorker.class)
                    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .setInputData(inputData)
                    .addTag(ChecklistScheduler.getNotificationWorkName(market))
                    .build();
            Log.d(TAG, "Expedited checklist work enqueued from exact alarm");
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "Expedited alarm work rejected; enqueueing non-expedited fallback", e);
            req = new OneTimeWorkRequest.Builder(ChecklistNotificationWorker.class)
                    .setInputData(inputData)
                    .addTag(ChecklistScheduler.getNotificationWorkName(market))
                    .build();
        }

        WorkManager.getInstance(context).enqueueUniqueWork(
                ChecklistScheduler.getNotificationWorkName(market),
                ExistingWorkPolicy.REPLACE,
                req
        );
    }
}
