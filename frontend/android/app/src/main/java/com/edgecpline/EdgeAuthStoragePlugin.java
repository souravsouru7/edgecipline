package com.edgecpline;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "EdgeAuthStorage")
public class EdgeAuthStoragePlugin extends Plugin {
    private static final String PREFS_NAME = "edge_auth_secure_storage";
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "edge_auth_access_token_key";
    private static final String CIPHER_TRANSFORM = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");

        if (key == null || key.trim().isEmpty()) {
            call.reject("Missing key");
            return;
        }
        if (value == null) {
            call.reject("Missing value");
            return;
        }

        try {
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORM);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());

            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

            JSObject envelope = new JSObject();
            envelope.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            envelope.put("value", Base64.encodeToString(encrypted, Base64.NO_WRAP));

            if (!getPrefs().edit().putString(key, envelope.toString()).commit()) {
                call.reject("Secure storage write failed");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Secure storage write failed");
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");

        if (key == null || key.trim().isEmpty()) {
            call.reject("Missing key");
            return;
        }

        try {
            String raw = getPrefs().getString(key, null);
            JSObject result = new JSObject();
            if (raw == null) {
                result.put("value", JSONObject.NULL);
                call.resolve(result);
                return;
            }

            JSObject envelope = new JSObject(raw);
            byte[] iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(envelope.getString("value"), Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORM);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            String value = new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);

            result.put("value", value);
            call.resolve(result);
        } catch (Exception e) {
            // Do NOT delete the stored blob on decryption failure.
            // Keystore can return errors transiently (screen lock, background sleep,
            // first boot before DE storage is unlocked). Deleting here causes permanent
            // token loss for a temporary error, which triggers the 5-10 min logout bug.
            android.util.Log.w("EdgeAuthStorage", "get() decryption transient error, returning null without delete: " + e.getMessage());
            call.reject("Secure storage read temporarily unavailable");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");

        if (key == null || key.trim().isEmpty()) {
            call.reject("Missing key");
            return;
        }

        if (!getPrefs().edit().remove(key).commit()) {
            call.reject("Secure storage remove failed");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (!getPrefs().edit().clear().commit()) {
            call.reject("Secure storage clear failed");
            return;
        }
        call.resolve();
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);

        SecretKey existing = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build();

        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }
}
