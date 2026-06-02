package com.edgecpline;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";
    private static final int REQUEST_POST_NOTIFICATIONS = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChecklistNotificationPlugin.class);
        super.onCreate(savedInstanceState);
        requestNotificationPermissionIfNeeded();
        handleNotificationIntent(getIntent());
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Requesting POST_NOTIFICATIONS permission (Android 13+)");
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                        REQUEST_POST_NOTIFICATIONS
                );
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Log.d(TAG, "POST_NOTIFICATIONS permission " + (granted ? "granted" : "denied"));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String screen = intent.getStringExtra("screen");
        if (!"checklist".equals(screen)) return;

        // Market is embedded in the notification intent by showOrUpdate()
        String rawMarket = intent.getStringExtra("market");
        final String market = (rawMarket != null) ? rawMarket : "Forex";

        // Build destination URL — MarketContext reads the ?market= param automatically
        String destination = "/checklist?market=" + Uri.encode(market);

        getBridge().getWebView().post(() -> {
            String currentUrl = getBridge().getWebView().getUrl();
            // Skip if already on the correct market's checklist to avoid flicker.
            // A Forex tap on the Indian Market checklist page (or vice versa) must still navigate.
            if (currentUrl != null && currentUrl.contains("/checklist")) {
                boolean urlIsIndian = currentUrl.contains("market=Indian_Market");
                boolean targetIsIndian = "Indian_Market".equals(market);
                if (urlIsIndian == targetIsIndian) return;
            }

            // Use replace() so the notification tap doesn't add an extra back-stack entry
            getBridge().eval(
                "window.location.replace('" + destination + "')",
                null
            );
        });
    }
}
