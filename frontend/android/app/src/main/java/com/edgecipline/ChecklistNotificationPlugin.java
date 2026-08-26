package com.edgecipline;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.Map;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "ChecklistNotification")
public class ChecklistNotificationPlugin extends Plugin {

    private static final String TAG = "ChecklistPlugin";
    private static ChecklistNotificationPlugin instance;

    @Override
    public void load() {
        instance = this;
        ChecklistNotificationManager.createChannel(getContext());
        migrateOldPrefs();
        Log.d(TAG, "Plugin loaded, channel created");
    }

    // Migrate single-market prefs (pre-multi-market build) to the Forex-specific prefs file.
    // Runs once; clears the old file afterward so it never runs again.
    private void migrateOldPrefs() {
        SharedPreferences oldPrefs = getContext()
                .getSharedPreferences("checklist_notification_prefs", Context.MODE_PRIVATE);
        // Nothing in old prefs → nothing to migrate
        if (!oldPrefs.contains(ChecklistNotificationManager.KEY_ENABLED)) return;

        SharedPreferences newPrefs = ChecklistNotificationManager.getPrefs(getContext(), "Forex");
        // Already migrated (new prefs already have data)
        if (newPrefs.contains(ChecklistNotificationManager.KEY_ENABLED)) {
            oldPrefs.edit().clear().apply();
            return;
        }

        SharedPreferences.Editor editor = newPrefs.edit();
        for (Map.Entry<String, ?> entry : oldPrefs.getAll().entrySet()) {
            Object v = entry.getValue();
            if (v instanceof Boolean) editor.putBoolean(entry.getKey(), (Boolean) v);
            else if (v instanceof String)  editor.putString(entry.getKey(), (String) v);
            else if (v instanceof Integer) editor.putInt(entry.getKey(), (Integer) v);
        }
        editor.commit();
        oldPrefs.edit().clear().apply();
        Log.d(TAG, "Migrated old checklist prefs → Forex prefs");
    }

    public static ChecklistNotificationPlugin getInstance() {
        return instance;
    }

    public void fireItemToggled(String itemId, boolean checked) {
        JSObject data = new JSObject();
        data.put("itemId", itemId);
        data.put("checked", checked);
        notifyListeners("checklistItemToggled", data);
    }

    // ── configure ────────────────────────────────────────────────────────
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            String market = call.getString("market", "Forex");
            SharedPreferences.Editor editor = getPrefs(market).edit();

            boolean enabled = call.getBoolean("enabled", false);
            editor.putBoolean(ChecklistNotificationManager.KEY_ENABLED, enabled);

            String time = call.getString("notificationTime", "09:00");
            editor.putString(ChecklistNotificationManager.KEY_TIME, time);

            String repeat = call.getString("repeatMode", "daily");
            editor.putString(ChecklistNotificationManager.KEY_REPEAT, repeat);

            JSArray customDaysArr = call.getArray("customDays");
            if (customDaysArr != null) {
                try {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < customDaysArr.length(); i++) {
                        if (i > 0) sb.append(",");
                        sb.append(customDaysArr.getInt(i));
                    }
                    editor.putString(ChecklistNotificationManager.KEY_CUSTOM_DAYS, sb.toString());
                } catch (JSONException ignored) {}
            }

            editor.putBoolean(ChecklistNotificationManager.KEY_PERSISTENT,
                    call.getBoolean("persistent", false));
            editor.putBoolean(ChecklistNotificationManager.KEY_RESET_ON,
                    call.getBoolean("resetEnabled", true));
            editor.putString(ChecklistNotificationManager.KEY_RESET_TIME,
                    call.getString("resetTime", "00:00"));
            editor.putString(ChecklistNotificationManager.KEY_STRATEGY,
                    call.getString("strategyName", "Pre-Trade Checklist"));
            editor.putString(ChecklistNotificationManager.KEY_MARKET, market);

            JSArray itemsArr = call.getArray("items");
            if (itemsArr != null && itemsArr.length() > 0) {
                List<ChecklistNotificationManager.ChecklistItem> existing =
                        ChecklistNotificationManager.loadItems(getContext(), market);
                List<ChecklistNotificationManager.ChecklistItem> merged = mergeItems(existing, itemsArr);
                editor.putString(ChecklistNotificationManager.KEY_ITEMS_JSON,
                        ChecklistNotificationManager.itemsToJson(merged));
                Log.d(TAG, "Saved " + merged.size() + " items for market=" + market);
            } else {
                Log.d(TAG, "No items provided in configure call");
            }

            editor.commit();

            // Cancel only this market's scheduled work before re-scheduling
            ChecklistScheduler.cancelAll(getContext(), market);

            if (enabled) {
                boolean notifEnabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
                Log.d(TAG, "Notifications enabled by system: " + notifEnabled);
                Log.d(TAG, "CHECKLIST_SAVE_SETTINGS market=" + market + " time=" + time);

                SharedPreferences prefs = getPrefs(market);
                ChecklistScheduler.scheduleNext(getContext(), prefs, market);
                Log.d(TAG, "CHECKLIST_WORK_SCHEDULED market=" + market);

                if (prefs.getBoolean(ChecklistNotificationManager.KEY_RESET_ON, true)) {
                    ChecklistScheduler.scheduleNextReset(getContext(), prefs, market);
                }

                long nextRunMs = ChecklistScheduler.millisUntilNextTime(time) + System.currentTimeMillis();
                Log.d(TAG, "CHECKLIST_NEXT_RUN_TIME market=" + market + " epochMs=" + nextRunMs);
            } else {
                ChecklistNotificationManager.dismiss(getContext(), market);
                Log.d(TAG, "Notification disabled and dismissed for market=" + market);
            }

            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "configure() failed: " + e.getMessage(), e);
            call.reject("configure failed: " + e.getMessage());
        }
    }

    // ── requestPermission ────────────────────────────────────────────────
    @PluginMethod
    public void requestPermission(PluginCall call) {
        boolean granted = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        Log.d(TAG, "requestPermission → granted=" + granted);
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    // ── syncItems ────────────────────────────────────────────────────────
    @PluginMethod
    public void syncItems(PluginCall call) {
        JSArray itemsArr = call.getArray("items");
        if (itemsArr == null) {
            call.reject("items is required");
            return;
        }
        String market = call.getString("market", "Forex");
        try {
            List<ChecklistNotificationManager.ChecklistItem> items = new ArrayList<>();
            for (int i = 0; i < itemsArr.length() && i < ChecklistNotificationManager.MAX_ITEMS; i++) {
                JSONObject o = itemsArr.getJSONObject(i);
                items.add(new ChecklistNotificationManager.ChecklistItem(
                        o.optString("id", String.valueOf(i)),
                        o.optString("label", ""),
                        o.optBoolean("checked", false)
                ));
            }
            getPrefs(market).edit()
                    .putString(ChecklistNotificationManager.KEY_ITEMS_JSON,
                            ChecklistNotificationManager.itemsToJson(items))
                    .commit();
            call.resolve();
        } catch (JSONException e) {
            call.reject("Invalid items: " + e.getMessage());
        }
    }

    // ── cancel ───────────────────────────────────────────────────────────
    @PluginMethod
    public void cancel(PluginCall call) {
        String market = call.getString("market", "Forex");
        getPrefs(market).edit()
                .putBoolean(ChecklistNotificationManager.KEY_ENABLED, false)
                .commit();
        ChecklistScheduler.cancelAll(getContext(), market);
        ChecklistNotificationManager.dismiss(getContext(), market);
        call.resolve();
    }

    // ── getState ─────────────────────────────────────────────────────────
    @PluginMethod
    public void getState(PluginCall call) {
        String market = call.getString("market", "Forex");
        SharedPreferences prefs = getPrefs(market);
        List<ChecklistNotificationManager.ChecklistItem> items =
                ChecklistNotificationManager.loadItems(getContext(), market);

        com.getcapacitor.JSArray jsItems = new com.getcapacitor.JSArray();
        for (ChecklistNotificationManager.ChecklistItem item : items) {
            JSObject o = new JSObject();
            o.put("id", item.id);
            o.put("label", item.label);
            o.put("checked", item.checked);
            jsItems.put(o);
        }

        JSObject result = new JSObject();
        result.put("enabled",          prefs.getBoolean(ChecklistNotificationManager.KEY_ENABLED, false));
        result.put("notificationTime", prefs.getString(ChecklistNotificationManager.KEY_TIME, "09:00"));
        result.put("repeatMode",       prefs.getString(ChecklistNotificationManager.KEY_REPEAT, "daily"));
        result.put("persistent",       prefs.getBoolean(ChecklistNotificationManager.KEY_PERSISTENT, false));
        result.put("resetEnabled",     prefs.getBoolean(ChecklistNotificationManager.KEY_RESET_ON, true));
        result.put("resetTime",        prefs.getString(ChecklistNotificationManager.KEY_RESET_TIME, "00:00"));
        result.put("strategyName",     prefs.getString(ChecklistNotificationManager.KEY_STRATEGY, ""));
        result.put("items", jsItems);
        call.resolve(result);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private SharedPreferences getPrefs(String market) {
        return ChecklistNotificationManager.getPrefs(getContext(), market);
    }

    private List<ChecklistNotificationManager.ChecklistItem> mergeItems(
            List<ChecklistNotificationManager.ChecklistItem> existing,
            JSArray incoming
    ) {
        List<ChecklistNotificationManager.ChecklistItem> result = new ArrayList<>();
        try {
            for (int i = 0; i < incoming.length() && i < ChecklistNotificationManager.MAX_ITEMS; i++) {
                JSONObject o = incoming.getJSONObject(i);
                String id    = o.optString("id", String.valueOf(i));
                String label = o.optString("label", "");
                boolean prevChecked = false;
                for (ChecklistNotificationManager.ChecklistItem ex : existing) {
                    if (ex.id.equals(id)) { prevChecked = ex.checked; break; }
                }
                result.add(new ChecklistNotificationManager.ChecklistItem(id, label, prevChecked));
            }
        } catch (JSONException ignored) {}
        return result;
    }
}
