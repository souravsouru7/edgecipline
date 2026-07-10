package com.edgecpline;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.List;

public class ChecklistActionReceiver extends BroadcastReceiver {

    public static final String ACTION_TOGGLE    = "com.edgecpline.CHECKLIST_TOGGLE";
    public static final String ACTION_RESET     = "com.edgecpline.CHECKLIST_RESET";
    public static final String EXTRA_ITEM_INDEX = "item_index";
    public static final String EXTRA_MARKET     = "market";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        if (action == null) return;

        String market = intent.getStringExtra(EXTRA_MARKET);
        if (market == null) market = "Forex";

        if (ACTION_TOGGLE.equals(action)) {
            int index = intent.getIntExtra(EXTRA_ITEM_INDEX, -1);
            if (index < 0) return;

            List<ChecklistNotificationManager.ChecklistItem> items =
                    ChecklistNotificationManager.toggleItem(context, index, market);

            ChecklistNotificationManager.showOrUpdate(context, market);

            notifyPlugin(items.get(index < items.size() ? index : 0));

        } else if (ACTION_RESET.equals(action)) {
            ChecklistNotificationManager.resetItems(context, market);
            ChecklistNotificationManager.showOrUpdate(context, market);
        }
    }

    private void notifyPlugin(ChecklistNotificationManager.ChecklistItem toggled) {
        try {
            ChecklistNotificationPlugin plugin = ChecklistNotificationPlugin.getInstance();
            if (plugin == null) return;
            plugin.fireItemToggled(toggled.id, toggled.checked);
        } catch (Exception ignored) {}
    }
}
