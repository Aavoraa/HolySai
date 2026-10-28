package edu.holysai.app.tracker

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import edu.holysai.app.MainActivity
import edu.holysai.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/** What the tracker screen shows. */
data class TrackerStatus(
    val running: Boolean = false,
    val location: Location? = null,
    val battery: Int? = null,
    val lastSentAt: Long? = null,
    val lastStudent: String? = null,
    val queued: Int = 0,
    val message: String? = null,
    val messageIsError: Boolean = false,
)

/**
 * Foreground service that turns this phone into a GPS device: it keeps a
 * location fix and, every interval, posts the newest fix to
 * POST {server}/api/v1/location with the device token. The server works out
 * which student the phone belongs to from the device's active assignment.
 */
class TrackerService : Service() {

    companion object {
        private const val CHANNEL = "gps_tracking"
        private const val NOTIFICATION_ID = 41
        private const val ACTION_STOP = "edu.holysai.app.tracker.STOP"

        private val _status = MutableStateFlow(TrackerStatus())
        val status: StateFlow<TrackerStatus> = _status.asStateFlow()

        fun start(context: Context) {
            TrackerConfig.enabled = true
            ContextCompat.startForegroundService(context, Intent(context, TrackerService::class.java))
        }

        fun stop(context: Context) {
            TrackerConfig.enabled = false
            context.stopService(Intent(context, TrackerService::class.java))
        }

        fun hasLocationPermission(context: Context) =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private var locationManager: LocationManager? = null
    @Volatile private var best: Location? = null
    @Volatile private var lastSentFixTime = 0L

    // All four methods are implemented: on Android 10 and older the platform calls
    // onStatusChanged/onProvider* directly, and a lambda listener would crash there.
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) = onFix(location)
        override fun onProviderEnabled(provider: String) = Unit
        override fun onProviderDisabled(provider: String) = Unit
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        TrackerConfig.init(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stop(this)
            return START_NOT_STICKY
        }
        if (!TrackerConfig.isConfigured || !hasLocationPermission(this)) {
            _status.update { it.copy(running = false, message = "Set up the device and allow location first.", messageIsError = true) }
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            startInForeground()
        } catch (e: Exception) {
            // Android 14+ refuses a location service restarted from the background (START_STICKY
            // after the process was killed) without "Allow all the time"; the app starts it again when opened.
            Log.w("TrackerService", "Could not start in foreground", e)
            _status.update { it.copy(running = false, message = "Open the tracker to resume tracking.", messageIsError = true) }
            stopSelf()
            return START_NOT_STICKY
        }
        if (loop == null) {
            requestUpdates()
            loop = scope.launch { runLoop() }
        }
        _status.update { it.copy(running = true, queued = TrackerConfig.queue().size, message = "Waiting for GPS fix…", messageIsError = false) }
        return START_STICKY
    }

    override fun onDestroy() {
        loop?.cancel()
        scope.cancel()
        locationManager?.removeUpdates(listener)
        _status.update { it.copy(running = false, message = "Tracking stopped", messageIsError = false) }
        super.onDestroy()
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "GPS tracking", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while this phone is sending its location to Holy Sai"
        })
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification("Starting…"), type)
    }

    private fun notification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).putExtra("tracker", true),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, TrackerService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("GPS tracker · ${TrackerConfig.deviceId}")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
    }

    @SuppressLint("MissingPermission") // checked in onStartCommand
    private fun requestUpdates() {
        val lm = getSystemService(LocationManager::class.java)
        locationManager = lm
        val minMs = (TrackerConfig.intervalSeconds * 1000L / 2).coerceAtLeast(2_000)
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (lm.allProviders.contains(provider)) {
                runCatching { lm.requestLocationUpdates(provider, minMs, 0f, listener, Looper.getMainLooper()) }
                runCatching { lm.getLastKnownLocation(provider)?.let { onFix(it) } }
            }
        }
    }

    /** Keeps the better of the current and new fix: newer wins unless it is far less accurate and barely newer. */
    private fun onFix(loc: Location) {
        val cur = best
        val better = cur == null || loc.time > cur.time + 10_000 ||
            (loc.time >= cur.time && (!loc.hasAccuracy() || !cur.hasAccuracy() || loc.accuracy <= cur.accuracy * 1.5f))
        if (better) {
            best = loc
            _status.update { it.copy(location = loc) }
        }
    }

    private suspend fun runLoop() {
        while (scope.isActive) {
            val fix = best
            val interval = TrackerConfig.intervalSeconds
            val battery = batteryPct()
            _status.update { it.copy(battery = battery) }
            // Only fresh fixes are sent; a phone without a fix sends nothing and shows as stale.
            if (fix != null && fix.time > lastSentFixTime && System.currentTimeMillis() - fix.time < interval * 2_000L + 60_000) {
                TrackerConfig.enqueue(point(fix, battery))
                lastSentFixTime = fix.time
            } else if (fix == null) {
                _status.update { it.copy(message = "Searching for GPS signal…", messageIsError = false) }
            }
            flush()
            delay(TrackerConfig.intervalSeconds * 1000L)
        }
    }

    private fun point(l: Location, battery: Int?) = JSONObject().apply {
        put("device_id", TrackerConfig.deviceId)
        put("latitude", l.latitude)
        put("longitude", l.longitude)
        if (l.hasAccuracy()) put("accuracy", l.accuracy.toDouble())
        if (l.hasAltitude()) put("altitude", l.altitude)
        if (l.hasSpeed()) put("speed", l.speed.toDouble())
        if (l.hasBearing()) put("heading", l.bearing.toDouble() % 360.0)
        if (battery != null) put("battery_level", battery)
        put("recorded_at", Instant.ofEpochMilli(l.time).toString())
    }

    /** Sends queued points oldest-first; stops at the first network failure and retries next tick. */
    private fun flush() {
        val queue = TrackerConfig.queue()
        while (queue.isNotEmpty()) {
            val p = queue.first()
            val result = try {
                post(p)
            } catch (e: IOException) {
                _status.update { it.copy(queued = queue.size, message = "No connection — ${queue.size} point(s) waiting", messageIsError = true) }
                updateNotification("Offline · ${queue.size} waiting")
                TrackerConfig.saveQueue(queue)
                return
            }
            val (code, json) = result
            when {
                code in 200..299 -> {
                    queue.removeAt(0)
                    json.optInt("next_interval_seconds", 0).takeIf { it in 5..3600 }?.let { TrackerConfig.intervalSeconds = it }
                    val student = json.optString("student_id").ifBlank { null }
                    _status.update { it.copy(lastSentAt = System.currentTimeMillis(), lastStudent = student, queued = queue.size, message = "Location sent", messageIsError = false) }
                    updateNotification("Sending every ${TrackerConfig.intervalSeconds} s · last ${java.text.DateFormat.getTimeInstance().format(java.util.Date())}")
                }
                code == 401 -> {
                    // A revoked or wrong token will not start working by retrying.
                    TrackerConfig.saveQueue(emptyList())
                    _status.update { it.copy(queued = 0, message = "The server rejected this device's token. Scan a new setup QR.", messageIsError = true) }
                    stop(this)
                    return
                }
                code == 429 -> {
                    TrackerConfig.saveQueue(queue)
                    _status.update { it.copy(queued = queue.size, message = "Server busy — will retry", messageIsError = true) }
                    return
                }
                code >= 500 -> {
                    TrackerConfig.saveQueue(queue)
                    _status.update { it.copy(queued = queue.size, message = "Server error — will retry", messageIsError = true) }
                    return
                }
                else -> {
                    // 400/403/409: this point will never be accepted (not assigned, device disabled,
                    // tracking off, too old). Drop it and say why.
                    queue.removeAt(0)
                    val msg = json.optString("message").ifBlank { "Point refused ($code)" }
                    _status.update { it.copy(queued = queue.size, message = msg, messageIsError = true) }
                    updateNotification(msg)
                }
            }
        }
        TrackerConfig.saveQueue(queue)
    }

    private fun post(body: JSONObject): Pair<Int, JSONObject> {
        val conn = (URL(TrackerConfig.endpoint()).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer ${TrackerConfig.token}")
            setRequestProperty("X-Client-Type", "integration")
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONTokener(text).nextValue() as? JSONObject }.getOrNull() ?: JSONObject()
            return code to json
        } finally {
            conn.disconnect()
        }
    }

    private fun batteryPct(): Int? =
        getSystemService(BatteryManager::class.java)?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }
}
