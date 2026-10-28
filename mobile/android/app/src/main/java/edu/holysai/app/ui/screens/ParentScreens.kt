package edu.holysai.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import edu.holysai.app.data.Api
import edu.holysai.app.data.money
import edu.holysai.app.data.num
import edu.holysai.app.data.objects
import edu.holysai.app.data.prettyDate
import edu.holysai.app.data.str
import edu.holysai.app.ui.Empty
import edu.holysai.app.ui.InfoCard
import edu.holysai.app.ui.Loaded
import edu.holysai.app.ui.LocalNav
import edu.holysai.app.ui.PrimaryButton
import edu.holysai.app.ui.ScreenList
import edu.holysai.app.ui.SectionTitle
import edu.holysai.app.ui.StatRow
import edu.holysai.app.ui.StatusChip
import edu.holysai.app.ui.rememberLoad
import org.json.JSONObject

/** The parent's profile and children, loaded once per session, plus the chosen child. */
class ParentState {
    private var parentId: String? = null
    private var children: List<JSONObject>? = null
    var selected by mutableIntStateOf(0)

    suspend fun load(): List<JSONObject> {
        children?.let { return it }
        val me = Api.get("/api/parents/me").obj()
        parentId = me.str("id")
        return (me.optJSONArray("children")?.objects().orEmpty()).also { children = it }
    }

    suspend fun current(): Pair<String, JSONObject>? {
        val kids = load()
        val child = kids.getOrNull(selected) ?: kids.firstOrNull() ?: return null
        return parentId!! to child
    }
}

/** Header naming the child the screen is about. */
@Composable
private fun ChildHeader(child: JSONObject) {
    Text(
        "${child.str("fullName")} · ${child.str("grade").orEmpty()}${child.str("section").orEmpty()}",
        style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
fun ChildTrackScreen() {
    val parent = LocalNav.current.parent
    val context = LocalContext.current
    val state = rememberLoad(parent.selected) {
        val (pid, child) = parent.current() ?: error("No children are linked to your account.")
        child to Api.get("/api/parents/$pid/children/${child.optString("id")}/location").obj()
    }
    Loaded(state) { (child, loc) ->
        ScreenList {
            item { ChildHeader(child) }
            item {
                InfoCard(loc.str("placeLabel") ?: loc.str("locationStatusLabel") ?: "Location", subtitle = "Updated ${prettyDate(loc.str("recordedAt"))}",
                    trailing = { StatusChip(loc.str("displayStatus")) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val lat = loc.num("latitude")
                        val lng = loc.num("longitude")
                        if (lat != null && lng != null) KeyValue("Coordinates", "%.5f, %.5f".format(lat, lng))
                        loc.num("accuracy")?.let { KeyValue("Accuracy", "±${it.toInt()} m") }
                        loc.num("batteryPct")?.let { KeyValue("Device battery", "${it.toInt()}%") }
                        loc.str("campusName")?.let { KeyValue("Campus", it) }
                        if (loc.optBoolean("isStale")) Text("This location is out of date.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        if (loc.optBoolean("isSampleData")) Text("Sample data — not a real location.", style = MaterialTheme.typography.bodySmall)
                        if (lat != null && lng != null) PrimaryButton("Open in Maps") {
                            val label = Uri.encode(child.str("firstName") ?: "Child")
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$lat,$lng?q=$lat,$lng($label)")))
                        }
                    }
                }
            }
            item { OutlinedButton(onClick = { state.reload() }) { Text("Refresh") } }
        }
    }
}

private suspend fun overview(parent: ParentState): Pair<JSONObject, JSONObject> {
    val (pid, child) = parent.current() ?: error("No children are linked to your account.")
    return child to Api.get("/api/parents/$pid/children/${child.optString("id")}/overview").obj()
}

@Composable
fun ChildTodayScreen() {
    val parent = LocalNav.current.parent
    val state = rememberLoad(parent.selected) { overview(parent) }
    Loaded(state) { (child, ov) ->
        val c = ov.optJSONObject("child") ?: child
        ScreenList {
            item { ChildHeader(child) }
            item {
                StatRow(
                    "Attendance" to (c.num("attendance")?.let { "${it.toInt()}%" } ?: "—"),
                    "Average" to (c.num("average")?.let { "${it.toInt()}%" } ?: "—"),
                    "Today" to (c.str("today") ?: "—"),
                )
            }
            item { SectionTitle("Gate today") }
            val gate = ov.optJSONArray("gateToday")?.objects().orEmpty()
            if (gate.isEmpty()) item { Text("No gate scans yet today.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(gate) { g ->
                InfoCard(if (g.str("direction") == "in") "Entered school" else "Left school",
                    subtitle = "${g.str("gate").orEmpty()} · ${g.str("method").orEmpty()} · ${prettyDate(g.str("occurredAt"))}")
            }
            ov.optJSONObject("bus")?.let { bus ->
                item { SectionTitle("School bus") }
                item {
                    InfoCard(bus.str("routeName") ?: "Bus", subtitle = "Bus ${bus.str("busNo").orEmpty()} · stop ${bus.str("stopName").orEmpty()}",
                        trailing = { StatusChip(bus.str("runStatus")) }) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            bus.str("eta")?.let { KeyValue("ETA", it) }
                            bus.num("delayMinutes")?.takeIf { it > 0 }?.let { KeyValue("Delay", "${it.toInt()} min") }
                            bus.str("pickupTime")?.let { KeyValue("Pickup", it.take(5)) }
                            bus.str("dropTime")?.let { KeyValue("Drop", it.take(5)) }
                            bus.str("driver")?.let { KeyValue("Driver", it) }
                            bus.str("attendant")?.let { KeyValue("Attendant", it) }
                        }
                    }
                }
            }
            val pickup = ov.optJSONArray("pickup")?.objects().orEmpty()
            if (pickup.isNotEmpty()) {
                item { SectionTitle("Authorised pickup") }
                items(pickup) { p ->
                    InfoCard(p.str("personName") ?: "", subtitle = "${p.str("relation").orEmpty()} · ${p.str("method").orEmpty()}", trailing = { StatusChip(p.str("status")) })
                }
            }
            val events = ov.optJSONArray("events")?.objects().orEmpty()
            if (events.isNotEmpty()) {
                item { SectionTitle("Coming up") }
                items(events) { e -> InfoCard(e.str("title") ?: "", subtitle = "${prettyDate(e.str("startsOn"))} · ${e.str("venue").orEmpty()}") }
            }
        }
    }
}

@Composable
fun ChildHomeworkScreen() {
    val parent = LocalNav.current.parent
    val state = rememberLoad(parent.selected) { overview(parent) }
    Loaded(state) { (child, ov) ->
        val list = ov.optJSONArray("homework")?.objects().orEmpty()
        ScreenList {
            item { ChildHeader(child) }
            if (list.isEmpty()) item { Text("No homework right now.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(list) { h ->
                InfoCard(h.str("title") ?: "", subtitle = "${h.str("subject").orEmpty()} · due ${prettyDate(h.str("dueOn"))}",
                    trailing = { StatusChip(if (h.optBoolean("submitted")) "Submitted" else h.str("status")) })
            }
        }
    }
}

@Composable
fun ChildFeesScreen() {
    val parent = LocalNav.current.parent
    val state = rememberLoad(parent.selected) {
        val (_, child) = parent.current() ?: error("No children are linked to your account.")
        child to Api.get("/api/family/children/${child.optString("id")}/fees").obj()
    }
    Loaded(state) { (child, fees) ->
        val sum = fees.optJSONObject("summary") ?: JSONObject()
        ScreenList {
            item { ChildHeader(child) }
            item { StatRow("Billed" to money(sum.num("billed")), "Paid" to money(sum.num("paid")), "Due" to money(sum.num("outstanding"))) }
            sum.optJSONObject("nextDue")?.let { nd ->
                item { InfoCard("Next payment ${money(nd.num("amount"))}", subtitle = "Due ${prettyDate(nd.str("date"))}") }
            }
            item { SectionTitle("Fee lines") }
            items(fees.optJSONArray("lines")?.objects().orEmpty()) { l ->
                InfoCard(l.str("description") ?: l.str("head") ?: "", subtitle = "Balance ${money(l.num("balance"))} · due ${prettyDate(l.str("dueDate"))}",
                    trailing = { StatusChip(l.str("status")) })
            }
            val pays = fees.optJSONArray("payments")?.objects().orEmpty()
            if (pays.isNotEmpty()) {
                item { SectionTitle("Payments") }
                items(pays) { p ->
                    InfoCard(money(p.num("amount")), subtitle = "${p.str("receiptNo").orEmpty()} · ${p.str("method").orEmpty()} · ${prettyDate(p.str("paidAt"))}",
                        trailing = { StatusChip(p.str("status")) })
                }
            }
            item { Text("To pay online, use the Parent 360 website.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
fun CircularsScreen() {
    val state = rememberLoad { Api.get("/api/family/circulars").arr().objects() }
    val act = rememberAction()
    Loaded(state) { list ->
        if (list.isEmpty()) Empty("No circulars.") else ScreenList {
            items(list) { c ->
                var busy by remember { mutableStateOf(false) }
                val needsAck = c.optBoolean("requiresAck") && !c.optBoolean("acknowledged")
                InfoCard(c.str("title") ?: "", subtitle = prettyDate(c.str("publishedAt")),
                    trailing = { StatusChip(if (c.optBoolean("acknowledged")) "Acknowledged" else if (needsAck) "Pending" else null) }) {
                    Text(c.str("body") ?: "", style = MaterialTheme.typography.bodyMedium)
                    if (needsAck) OutlinedButton(enabled = !busy, onClick = {
                        act({ busy = it }, "Acknowledged", { Api.post("/api/family/circulars/${c.str("id")}/acknowledge") }) { state.reload() }
                    }) { Text("Acknowledge") }
                }
            }
        }
    }
}
