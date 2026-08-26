package com.edgecipline;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.service.notification.StatusBarNotification;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Paint;
import android.os.Build;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ChecklistNotificationManager {

    private static final String TAG = "ChecklistNotifMgr";

    public static final String KEY_ENABLED     = "enabled";
    public static final String KEY_TIME        = "notification_time";
    public static final String KEY_REPEAT      = "repeat_mode";
    public static final String KEY_CUSTOM_DAYS = "custom_days";
    public static final String KEY_PERSISTENT  = "persistent";
    public static final String KEY_RESET_ON    = "reset_enabled";
    public static final String KEY_RESET_TIME  = "reset_time";
    public static final String KEY_STRATEGY    = "strategy_name";
    public static final String KEY_ITEMS_JSON  = "items_json";
    public static final String KEY_MARKET      = "market";

    // One SharedPreferences file per market
    private static final String PREFS_NAME_FOREX   = "checklist_notification_prefs_forex";
    private static final String PREFS_NAME_INDIAN  = "checklist_notification_prefs_indian";
    // Keep for backward-compat reads during migration only
    public  static final String PREFS_NAME         = PREFS_NAME_FOREX;

    // Notification IDs: one per market so both can coexist in the tray
    public static final int NOTIFICATION_ID_FOREX  = 7001;
    public static final int NOTIFICATION_ID_INDIAN = 7002;
    // Legacy alias
    public static final int NOTIFICATION_ID        = NOTIFICATION_ID_FOREX;

    public static final int MAX_ITEMS = 8;

    private static final String CHANNEL_ID_BASE = "edgecipline_checklist";
    static final String CHANNEL_ID_OLD  = "edgecipline_checklist";
    private static final String KEY_CHANNEL_VER = "channel_version";

    // ── Market helpers ────────────────────────────────────────────────────

    public static String getPrefsName(String market) {
        return "Indian_Market".equals(market) ? PREFS_NAME_INDIAN : PREFS_NAME_FOREX;
    }

    public static SharedPreferences getPrefs(Context ctx, String market) {
        return ctx.getSharedPreferences(getPrefsName(market), Context.MODE_PRIVATE);
    }

    /** Backward-compat overload — defaults to Forex. */
    public static SharedPreferences getPrefs(Context ctx) {
        return getPrefs(ctx, "Forex");
    }

    public static int getNotificationId(String market) {
        return "Indian_Market".equals(market) ? NOTIFICATION_ID_INDIAN : NOTIFICATION_ID_FOREX;
    }

    // ── Channel ──────────────────────────────────────────────────────────

    /** Returns the active channel ID, stored in the Forex SharedPreferences (channel is shared). */
    public static String getChannelId(Context ctx) {
        return CHANNEL_ID_BASE;
    }

    /**
     * Creates the notification channel if needed.
     * If the current channel is blocked (IMPORTANCE_NONE) it bumps the version
     * so Android creates a completely fresh channel the next call.
     */
    public static String createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return CHANNEL_ID_BASE;
        }
        NotificationManager nm = (NotificationManager)
                ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return getChannelId(ctx);

        // Clean up old-version channels. The canonical checklist channel ID is edgecipline_checklist.
        for (String old : new String[]{ CHANNEL_ID_BASE + "_v1", CHANNEL_ID_BASE + "_v2" }) {
            if (nm.getNotificationChannel(old) != null) {
                nm.deleteNotificationChannel(old);
                Log.d(TAG, "Deleted legacy channel: " + old);
            }
        }

        String channelId = getChannelId(ctx);
        NotificationChannel existing = nm.getNotificationChannel(channelId);


        if (existing == null) {
            Log.d("Notifications", "Creating channel: " + channelId);
            NotificationChannel ch = new NotificationChannel(
                    channelId,
                    "Pre-Trade Checklist",
                    NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Daily interactive pre-trade checklist");
            ch.setShowBadge(true);
            ch.enableLights(true);
            ch.setLightColor(0xFF0D9E6E);
            ch.enableVibration(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
            Log.d("Notifications", "Channel created successfully");
            Log.d(TAG, "Channel created: " + channelId);
        } else {
            Log.d(TAG, "Channel OK: " + channelId + " importance=" + existing.getImportance());
        }
        return channelId;
    }

    // ── SharedPreferences ─────────────────────────────────────────────────

    public static List<ChecklistItem> loadItems(Context ctx, String market) {
        String json = getPrefs(ctx, market).getString(KEY_ITEMS_JSON, "[]");
        return parseItems(json);
    }

    /** Backward-compat overload. */
    public static List<ChecklistItem> loadItems(Context ctx) {
        return loadItems(ctx, "Forex");
    }

    public static List<ChecklistItem> parseItems(String json) {
        List<ChecklistItem> list = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length() && i < MAX_ITEMS; i++) {
                JSONObject obj = arr.getJSONObject(i);
                list.add(new ChecklistItem(
                        obj.optString("id", String.valueOf(i)),
                        obj.optString("label", ""),
                        obj.optBoolean("checked", false)
                ));
            }
        } catch (JSONException e) {
            Log.e(TAG, "parseItems failed: " + e.getMessage());
        }
        return list;
    }

    public static String itemsToJson(List<ChecklistItem> items) {
        JSONArray arr = new JSONArray();
        for (ChecklistItem item : items) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("id", item.id);
                obj.put("label", item.label);
                obj.put("checked", item.checked);
            } catch (JSONException ignored) {}
            arr.put(obj);
        }
        return arr.toString();
    }

    public static List<ChecklistItem> toggleItem(Context ctx, int index, String market) {
        List<ChecklistItem> items = loadItems(ctx, market);
        if (index >= 0 && index < items.size()) {
            ChecklistItem item = items.get(index);
            items.set(index, new ChecklistItem(item.id, item.label, !item.checked));
        }
        getPrefs(ctx, market).edit().putString(KEY_ITEMS_JSON, itemsToJson(items)).commit();
        return items;
    }

    /** Backward-compat overload. */
    public static List<ChecklistItem> toggleItem(Context ctx, int index) {
        return toggleItem(ctx, index, "Forex");
    }

    public static List<ChecklistItem> resetItems(Context ctx, String market) {
        List<ChecklistItem> items = loadItems(ctx, market);
        List<ChecklistItem> reset = new ArrayList<>();
        for (ChecklistItem item : items) {
            reset.add(new ChecklistItem(item.id, item.label, false));
        }
        getPrefs(ctx, market).edit().putString(KEY_ITEMS_JSON, itemsToJson(reset)).commit();
        return reset;
    }

    /** Backward-compat overload. */
    public static List<ChecklistItem> resetItems(Context ctx) {
        return resetItems(ctx, "Forex");
    }

    // ── Notification builder ──────────────────────────────────────────────

    /**
     * Posts (or updates) the checklist notification for the given market.
     * Returns an error string if posting failed, null on success.
     */
    public static String showOrUpdate(Context ctx, String market) {
        try {
            SharedPreferences prefs = getPrefs(ctx, market);
            boolean enabled = prefs.getBoolean(KEY_ENABLED, false);
            Log.d(TAG, "showOrUpdate [" + market + "] called — enabled=" + enabled);
            if (!enabled) return null;

            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
                Log.w(TAG, "Notifications disabled at app level");
                return "Notifications are disabled for this app. Please enable them in Settings.";
            }

            String channelId = createChannel(ctx);

            // Channel-specific block check (Android 8+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                android.app.NotificationManager nm =
                        (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    android.app.NotificationChannel ch = nm.getNotificationChannel(channelId);
                    if (ch != null && ch.getImportance() == android.app.NotificationManager.IMPORTANCE_NONE) {
                        Log.w(TAG, "Channel " + channelId + " is blocked");
                        return "Notification channel is blocked. Go to Settings → Apps → Edgecipline → Notifications and enable Pre-Trade Checklist.";
                    }
                }
            }

            List<ChecklistItem> items = loadItems(ctx, market);
            String strategyName = prefs.getString(KEY_STRATEGY, "Pre-Trade Checklist");
            boolean persistent  = prefs.getBoolean(KEY_PERSISTENT, false);

            int total   = items.size();
            int checked = 0;
            for (ChecklistItem item : items) if (item.checked) checked++;

            StringBuilder sb = new StringBuilder();
            for (ChecklistItem item : items) {
                sb.append(item.checked ? "✓ " : "○ ").append(item.label).append("\n");
            }

            int notifId = getNotificationId(market);

            Intent openIntent = new Intent(ctx, MainActivity.class);
            openIntent.setAction(Intent.ACTION_VIEW);
            openIntent.putExtra("screen", "checklist");
            openIntent.putExtra("market", market);
            openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent openPi = PendingIntent.getActivity(
                    ctx, notifId + 100, openIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            Notification notification = new NotificationCompat.Builder(ctx, channelId)
                    .setSmallIcon(R.drawable.ic_stat_edgecipline)
                    .setColor(0xFF0D9E6E)
                    .setContentTitle("Pre-Trade Checklist — " + strategyName)
                    .setContentText(checked + "/" + total + " done")
                    .setStyle(new NotificationCompat.BigTextStyle()
                            .bigText(sb.toString().trim())
                            .setSummaryText(checked + "/" + total + " done"))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(openPi)
                    .setOnlyAlertOnce(true)
                    .setAutoCancel(false)
                    .setOngoing(persistent)
                    .build();

            try {
                NotificationManagerCompat.from(ctx).notify(notifId, notification);
                Log.d(TAG, "notify() called — market=" + market + " channel=" + channelId
                        + " items=" + total + " checked=" + checked);
            } catch (SecurityException se) {
                // Android 13+ can throw SecurityException if POST_NOTIFICATIONS
                // permission was revoked after the areNotificationsEnabled() check above.
                Log.e(TAG, "SecurityException posting notification — POST_NOTIFICATIONS permission denied: "
                        + se.getMessage());
                return "Notification permission was denied. Please enable notifications for Edgecipline in Settings.";
            }

            // Verify the notification actually landed in the tray (API 23+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                android.app.NotificationManager nm2 =
                        (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm2 != null) {
                    boolean found = false;
                    for (StatusBarNotification sbn : nm2.getActiveNotifications()) {
                        if (sbn.getId() == notifId) { found = true; break; }
                    }
                    if (!found) {
                        Log.e(TAG, "notify() was called but notification NOT in tray — channel silently blocked?");
                        return "Notification was rejected by the system. Go to Settings → Apps → Edgecipline → Notifications and make sure 'Pre-Trade Checklist' is enabled.";
                    }
                    Log.d(TAG, "Notification confirmed in tray ✓");
                }
            }
            return null;

        } catch (Exception e) {
            Log.e(TAG, "showOrUpdate failed: " + e.getMessage(), e);
            return "Failed to show notification: " + e.getMessage();
        }
    }

    /** Backward-compat overload. */
    public static String showOrUpdate(Context ctx) {
        return showOrUpdate(ctx, "Forex");
    }

    public static void dismiss(Context ctx, String market) {
        NotificationManagerCompat.from(ctx).cancel(getNotificationId(market));
    }

    /** Backward-compat overload. */
    public static void dismiss(Context ctx) {
        dismiss(ctx, "Forex");
    }

    // ── DTO ──────────────────────────────────────────────────────────────

    public static class ChecklistItem {
        public final String  id;
        public final String  label;
        public final boolean checked;

        public ChecklistItem(String id, String label, boolean checked) {
            this.id      = id;
            this.label   = label;
            this.checked = checked;
        }
    }
}
