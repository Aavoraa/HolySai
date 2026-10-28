# Holy Sai 360 — Android app

A native Android app (Kotlin + Jetpack Compose, no Expo) for the Holy Sai REST API.
Home shows the signed-in user's role and their main jobs as tiles; everything else is
in the ☰ menu, including the "Me" group (My Attendance, Leave, Payslips, Notifications,
Tasks, Profile) shared by every staff role.

## Build the APK

Needs the Android SDK (installed with Android Studio). Gradle is downloaded by the wrapper.

```bash
cd mobile/android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk`.

Without `keystore.properties` the release build is signed with the local debug key. That is
fine for sideloading but not for Play Store. To use your own key, create
`mobile/android/keystore.properties` (never committed) with `storeFile`, `storePassword`,
`keyAlias` and `keyPassword`.

## Server address

The default is `https://holysai-vert.vercel.app` (`DEFAULT_API_URL` in `app/build.gradle.kts`).
You can change it on the sign-in screen under **Server settings**. For a local API on the
emulator, use `http://10.0.2.2:4000`. Plain HTTP is allowed only for the local development
hosts listed in `res/xml/network_security_config.xml`.

## GPS Tracker mode

The same app can turn a phone into a student's GPS device (the prototype for dedicated trackers).
On the sign-in screen tap **Use this phone as a GPS tracker** — no user account is needed on the phone.

1. On the web, register a device of type **Android phone** (GPS Devices → Register device) and pick
   **Android phone setup** in the token window.
2. In the app, **Scan setup QR** (or scan it with the phone camera — the `holysai-tracker:` link opens
   the app). The server address, device ID and token are stored in encrypted preferences.
3. **Show device QR** and scan it on the student's page to assign the phone to the student.
4. **START TRACKING** runs a location foreground service (`tracker/TrackerService.kt`) that posts the
   newest fix to `POST /api/v1/location` every 30 s, queues points while offline, and stops if the
   token is revoked.

Permissions: fine location, notifications (Android 13+), camera (setup QR). Set the app's battery
usage to **Unrestricted** on tracker phones. Details: [docs/GPS-DEVICES.md](../docs/GPS-DEVICES.md).

## Stand-alone GPS Tracker app (`tracker` module)

A separate, small APK — **Holy Sai GPS Tracker** (`edu.holysai.tracker`) — for phones that only act as
a student's GPS device. Same setup QR, same `POST /api/v1/location`, no sign-in. On top of the tracker
mode above it adds:

- resumes tracking after a reboot or app update (needs location **Allow all the time**),
- a partial wake lock so points keep going out with the screen off,
- a reliability checklist (location on, "all the time" access, battery unrestricted) with fix buttons,
- satellites used/seen, speed and fix time, a **Send now** button and an activity log for testing.

**Version 2 — connect by scanning the device label.** No setup QR is needed any more:

1. Open the app → **Scan device QR** → scan the label printed on GPS Devices (or tap
   *No label? Register this phone as a new device*).
2. An administrator (holding `tracking.manage`) signs in **once** on the phone. The server issues the
   device token straight to the phone; the admin session is signed out when the wizard closes.
3. Pick the student (search by name or admission number). Reassigning asks first.
4. Tracking starts. The dashboard shows what the **server** has stored — the student, points and
   distance today, first/last point, and whether the server sees the device as online — plus this
   session's running time, points sent, failures and success rate (`GET /api/v1/device/status`).

The old setup QR (`holysai-tracker:setup?…`) and manual entry still work.

```bash
cd mobile/android
./gradlew :tracker:assembleRelease     # tracker/build/outputs/apk/release/tracker-release.apk
./gradlew :tracker:assembleDebug       # debug build: plain HTTP allowed, e.g. http://192.168.1.20:4000
```

The release build accepts HTTPS only (plus the emulator/localhost hosts). To test a phone against
an API on your PC, install the debug APK and enter `http://<PC LAN IP>:4000` as the server.
