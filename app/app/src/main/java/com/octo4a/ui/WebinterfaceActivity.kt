package com.octo4a.ui

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import com.octo4a.R
import kotlinx.android.synthetic.main.activity_webinterface.*

const val WEBINTERFACE_ADDRESS = "127.0.0.1:5000"
const val DASHBOARD_URL = "file:///android_asset/dashboard/index.html"
const val CLASSIC_UI_URL = "http://$WEBINTERFACE_ADDRESS"

class WebinterfaceActivity : AppCompatActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_webinterface)
        webview.webViewClient = WebinterfaceClient(this)
        webview.settings.loadsImagesAutomatically = true
        webview.settings.javaScriptEnabled = true
        webview.settings.domStorageEnabled = true
        webview.settings.userAgentString = "TouchUI"
        webview.scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
        // The dashboard ships inside the app and calls OctoPrint's REST API on localhost.
        webview.settings.allowFileAccess = true
        webview.settings.allowUniversalAccessFromFileURLs = true
        webview.addJavascriptInterface(DashboardBridge(applicationContext), "Octo4a")
        webview.setBackgroundColor(0xFF1A1512.toInt())
        webview.loadUrl(DASHBOARD_URL)
    }

    override fun onResume() {
        window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN)
        super.onResume()
    }

    @Suppress("DEPRECATION")
    fun isPinned(): Boolean {
        val activityManager = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            (activityManager.lockTaskModeState
                    != ActivityManager.LOCK_TASK_MODE_NONE)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP){
            activityManager.isInLockTaskMode
        } else {
            false
        }
    }

    override fun onBackPressed() {
        if (!isPinned()){
            super.onBackPressed()
        } else if (webview.canGoBack()) {
            webview.goBack()
        }
    }

    private fun webViewLoadingFinished() {
        webview.visibility = View.VISIBLE
        loadingIndicator.visibility = View.GONE
    }

    private class WebinterfaceClient(val activity: WebinterfaceActivity): WebViewClient() {
        override fun onPageFinished(view: WebView?, url: String?) {
            activity.webViewLoadingFinished()
            super.onPageFinished(view, url)
        }

        @RequiresApi(Build.VERSION_CODES.LOLLIPOP)
        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val url = request?.url
            return if (url?.authority == WEBINTERFACE_ADDRESS || url?.scheme == "file") {
                false
            } else {
                activity.stopLockTask()
                val intent = Intent(Intent.ACTION_VIEW, request?.url)
                activity.startActivity(intent)
                true
            }
        }
    }
}
