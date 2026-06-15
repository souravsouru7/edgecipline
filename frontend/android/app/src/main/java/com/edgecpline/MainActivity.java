package com.edgecpline;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";
    private static final int REQUEST_POST_NOTIFICATIONS = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChecklistNotificationPlugin.class);
        registerPlugin(EdgeAuthStoragePlugin.class);
        super.onCreate(savedInstanceState);
        NotificationChannelInitializer.ensureChannels(getApplicationContext());
        enableWebViewCookies();
        requestNotificationPermissionIfNeeded();
        handleNotificationIntent(getIntent());
    }

    /**
     * Ensures the Capacitor WebView accepts and sends cookies for cross-origin
     * requests (capacitor://localhost → https://api.stratedge.live).
     * Without this, the httpOnly refresh-token cookie (SameSite=None) is not
     * transmitted on silent refresh POST requests, logging users out on every
     * app kill/reopen.
     */
    private void enableWebViewCookies() {
        try {
            CookieManager cookieManager = CookieManager.getInstance();
            cookieManager.setAcceptCookie(true);
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                cookieManager.setAcceptThirdPartyCookies(webView, true);
                Log.d(TAG, "WebView third-party cookies enabled");
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not configure WebView cookies: " + e.getMessage());
        }
    }

    /**
     * Capacitor calls load() after the bridge and WebView are fully initialised.
     * We re-apply the third-party cookie flag here to cover the case where
     * getBridge() was null during onCreate().
     */
    @Override
    public void load() {
        super.load();
        try {
            WebView webView = getBridge().getWebView();
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
            Log.d(TAG, "WebView third-party cookies confirmed via load()");
        } catch (Exception e) {
            Log.w(TAG, "Could not configure WebView cookies in load(): " + e.getMessage());
        }
        // Re-attempt notification intent navigation — bridge is now ready.
        // On cold-start, handleNotificationIntent() in onCreate() bails early because
        // getBridge() is null. load() fires once the bridge and WebView are fully init.
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

    /**
     * Flush WebView cookie database to disk before Android may kill the process.
     * Without this, the httpOnly refresh-token cookie can be silently lost on
     * OOM-kill, requiring the user to log in again.
     */
    @Override
    public void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
            Log.d(TAG, "onPause: CookieManager flushed to disk");
        } catch (Exception e) {
            Log.w(TAG, "onPause: CookieManager flush failed: " + e.getMessage());
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
        // Sanitise: fall back to Forex for null / empty / unknown markets
        final String market = (rawMarket != null && !rawMarket.trim().isEmpty()) ? rawMarket : "Forex";

        // Uri.encode() percent-encodes all special chars (including single quotes → %27),
        // so the JS eval below is safe against injection even without extra escaping.
        final String destination = "/checklist?market=" + Uri.encode(market);

        // Guard: bridge may be null if the activity is being destroyed.
        if (getBridge() == null || getBridge().getWebView() == null) {
            Log.w(TAG, "handleNotificationIntent: bridge not ready, skipping navigation");
            return;
        }

        getBridge().getWebView().post(() -> {
            try {
                if (getBridge() == null || getBridge().getWebView() == null) return;
                String currentUrl = getBridge().getWebView().getUrl();
                // Skip if already on the correct market's checklist to avoid flicker.
                // A Forex tap on the Indian Market checklist page (or vice versa) must still navigate.
                if (currentUrl != null && currentUrl.contains("/checklist")) {
                    boolean urlIsIndian = currentUrl.contains("market=Indian_Market");
                    boolean targetIsIndian = "Indian_Market".equals(market);
                    if (urlIsIndian == targetIsIndian) return;
                }
                // Use replace() so the notification tap doesn't add an extra back-stack entry
                getBridge().eval("window.location.replace('" + destination + "')", null);
            } catch (Exception e) {
                Log.e(TAG, "handleNotificationIntent: WebView navigation failed: " + e.getMessage(), e);
            }
        });
    }
}
