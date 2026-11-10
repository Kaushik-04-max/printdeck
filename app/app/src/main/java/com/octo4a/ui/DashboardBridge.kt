package com.octo4a.ui

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import org.yaml.snakeyaml.Yaml
import java.io.File

/** Exposed to the bundled dashboard as `window.Octo4a`. */
class DashboardBridge(private val context: Context) {
    private val channelId = "akara_alerts"

    /** The global API key OctoPrint wrote to its own config, so the user never has to paste it. */
    @JavascriptInterface
    fun getApiKey(): String = try {
        val file = File("${context.getExternalFilesDir(null)?.absolutePath}/.octoprint/config.yaml")
        @Suppress("UNCHECKED_CAST")
        val api = (Yaml().load(file.inputStream()) as? Map<String, Any>)?.get("api") as? Map<String, Any>
        api?.get("key") as? String ?: ""
    } catch (e: Exception) {
        ""
    }

    @JavascriptInterface
    fun notify(title: String, message: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(channelId, "Print alerts", NotificationManager.IMPORTANCE_HIGH))
        }
        val n = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(com.octo4a.R.drawable.ic_print_24px)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        nm.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), n)
    }
}
