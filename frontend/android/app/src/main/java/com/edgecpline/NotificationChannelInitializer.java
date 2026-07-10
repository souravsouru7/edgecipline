package com.edgecpline;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.util.Log;

public final class NotificationChannelInitializer {

    private static final String TAG = "Notifications";
    public static final String DEFAULT_FCM_CHANNEL_ID = "edgecipline_risk";

    private NotificationChannelInitializer() {}

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            Log.e(TAG, "NotificationManager unavailable");
            return;
        }

        deleteLegacyChannels(manager);

        createChannel(
                manager,
                "edgecipline_risk",
                "Risk Alerts",
                "Revenge trading, overtrading, and daily loss warnings",
                NotificationManager.IMPORTANCE_HIGH,
                Notification.VISIBILITY_PUBLIC,
                0xFFE53935,
                true,
                true
        );
        createChannel(
                manager,
                "edgecipline_discipline",
                "Discipline Alerts",
                "Setup checklist, mood risk, and trade quality warnings",
                NotificationManager.IMPORTANCE_DEFAULT,
                Notification.VISIBILITY_PRIVATE,
                0xFFF59E0B,
                true,
                true
        );
        createChannel(
                manager,
                "edgecipline_insights",
                "Performance Insights",
                "Repeated mistakes, weekly summaries, and improvement tips",
                NotificationManager.IMPORTANCE_LOW,
                Notification.VISIBILITY_PRIVATE,
                0xFF0D9E6E,
                true,
                false
        );
        createChannel(
                manager,
                "edgecipline_coaching",
                "Coaching",
                "Confidence and discipline reinforcement messages",
                NotificationManager.IMPORTANCE_LOW,
                Notification.VISIBILITY_PRIVATE,
                0xFF3B82F6,
                false,
                false
        );
        createChannel(
                manager,
                "edgecipline_session",
                "Session Reminders",
                "London, New York, and Asian session start reminders",
                NotificationManager.IMPORTANCE_DEFAULT,
                Notification.VISIBILITY_PUBLIC,
                0xFF8B5CF6,
                true,
                true
        );
        createChannel(
                manager,
                "edgecipline_ocr",
                "OCR Results",
                "Trade screenshot processing completion and failure alerts",
                NotificationManager.IMPORTANCE_DEFAULT,
                Notification.VISIBILITY_PRIVATE,
                0xFF0EA5E9,
                true,
                true
        );
        ChecklistNotificationManager.createChannel(context);
        validateDefaultChannel(manager);
    }

    private static void createChannel(
            NotificationManager manager,
            String id,
            String name,
            String description,
            int importance,
            int visibility,
            int lightColor,
            boolean lights,
            boolean vibration
    ) {
        if (manager.getNotificationChannel(id) != null) {
            Log.d(TAG, "Channel already exists: " + id);
            return;
        }

        Log.d(TAG, "Creating channel: " + id);
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription(description);
        channel.setShowBadge(true);
        channel.enableLights(lights);
        channel.setLightColor(lightColor);
        channel.enableVibration(vibration);
        channel.setLockscreenVisibility(visibility);
        manager.createNotificationChannel(channel);
        Log.d(TAG, "Channel created successfully");
    }

    private static void validateDefaultChannel(NotificationManager manager) {
        NotificationChannel channel = manager.getNotificationChannel(DEFAULT_FCM_CHANNEL_ID);
        if (channel == null) {
            Log.e(TAG, "Default FCM fallback channel missing");
        }
    }

    private static void deleteLegacyChannels(NotificationManager manager) {
        for (String legacyId : new String[]{
                "smart_coach",
                "edgecipline_checklist_v1",
                "edgecipline_checklist_v2"
        }) {
            if (manager.getNotificationChannel(legacyId) != null) {
                manager.deleteNotificationChannel(legacyId);
                Log.d(TAG, "Deleted legacy channel: " + legacyId);
            }
        }
    }
}
