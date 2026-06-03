# ─── Capacitor ────────────────────────────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-keepclassmembers class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.annotation.PluginMethod class * { *; }

# ─── App-specific Capacitor plugins ───────────────────────────────────────────
-keep class com.edgecpline.** { *; }
-keepclassmembers class com.edgecpline.** { *; }

# ─── Firebase ─────────────────────────────────────────────────────────────────
-keep class com.google.firebase.** { *; }
-keepclassmembers class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-keepclassmembers class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ─── @capacitor-firebase/authentication — optional providers not in this build ─
# The plugin bundles handlers for Apple, Facebook, Twitter, GitHub, etc.
# We only use Google sign-in, so suppress R8 errors for the unused SDK references.
-dontwarn com.facebook.**
-dontwarn com.twitter.**
-dontwarn com.apple.**
-dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.handlers.FacebookAuthProviderHandler
-dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.handlers.AppleAuthProviderHandler
-dontwarn io.capawesome.capacitorjs.plugins.firebase.authentication.handlers.TwitterAuthProviderHandler

# ─── WorkManager ──────────────────────────────────────────────────────────────
-keep class androidx.work.** { *; }
-keepclassmembers class androidx.work.** { *; }
# Keep Worker subclasses so WorkManager can instantiate them by class name
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }

# ─── AndroidX / Jetpack ───────────────────────────────────────────────────────
-keep class androidx.core.app.** { *; }
-keep class androidx.appcompat.** { *; }

# ─── Coroutines / Kotlin (if used transitively) ───────────────────────────────
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-dontwarn kotlinx.coroutines.**

# ─── Gson / JSON (used by Capacitor internals) ────────────────────────────────
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapterFactory { *; }
-keep class * implements com.google.gson.JsonSerializer { *; }
-keep class * implements com.google.gson.JsonDeserializer { *; }
-dontwarn sun.misc.**

# ─── WebView / JavaScript bridge ──────────────────────────────────────────────
# Capacitor's bridge uses @JavascriptInterface methods — must not be renamed
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ─── Crash reporting (preserve stack traces) ──────────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ─── Serializable / Parcelable ────────────────────────────────────────────────
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}
