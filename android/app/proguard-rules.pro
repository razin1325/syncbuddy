# SyncBuddy ProGuard & R8 Optimization Rules

# 1. Keep all React Native Core & Reflection
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
    @com.facebook.react.uimanager.annotations.ReactProp *;
    @com.facebook.react.uimanager.annotations.ReactPropGroup *;
}
-dontwarn com.facebook.react.**
-dontwarn com.facebook.jni.**

# 2. Keep SyncBuddy Native Modules & Managers
-keep class com.syncbuddy.** { *; }
-keepclassmembers class com.syncbuddy.** { *; }

# 3. Keep Google Media3 (ExoPlayer) Universal Player
-keep class androidx.media3.** { *; }
-keepclassmembers class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# 4. Keep Google Play Services & Code Scanner
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# 5. Keep Kotlin Standard Library & Reflection
-keep class kotlin.** { *; }
-keep class kotlin.reflect.** { *; }
-dontwarn kotlin.**

# 6. AndroidX & Material
-dontwarn androidx.**
