package edu.holysai.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import edu.holysai.app.data.Api
import edu.holysai.app.data.Session
import edu.holysai.app.data.User
import edu.holysai.app.data.friendly
import edu.holysai.app.data.prettyDate
import edu.holysai.app.data.str
import edu.holysai.app.ui.InfoCard
import edu.holysai.app.ui.Loaded
import edu.holysai.app.ui.LocalNav
import edu.holysai.app.ui.PrimaryButton
import edu.holysai.app.ui.ScreenList
import edu.holysai.app.ui.SectionTitle
import edu.holysai.app.ui.hasParentPortal
import edu.holysai.app.ui.homeTiles
import edu.holysai.app.ui.rememberLoad
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MyLocation
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import edu.holysai.app.R
import edu.holysai.app.ui.IconTile
import edu.holysai.app.ui.LogoTile
import edu.holysai.app.ui.theme.BlushGradient
import edu.holysai.app.ui.theme.Gold
import edu.holysai.app.ui.theme.GoldDeep
import edu.holysai.app.ui.theme.GoldTint
import edu.holysai.app.ui.theme.MaroonGradient
import edu.holysai.app.ui.theme.MaroonTop
import edu.holysai.app.ui.theme.Serif
import edu.holysai.app.ui.theme.cardBorder
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

@Composable
fun LoginScreen(onSignedIn: (User) -> Unit, onTracker: () -> Unit = {}) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(Session.baseUrl) }
    var showServer by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (identifier.isBlank() || password.isEmpty()) { error = "Enter your email or phone and password."; return }
        busy = true; error = null
        scope.launch {
            try {
                Session.baseUrl = server
                onSignedIn(Api.login(identifier, password))
            } catch (e: Exception) {
                error = e.friendly()
            }
            busy = false
        }
    }

    Box(Modifier.fillMaxSize().background(MaroonGradient)) {
        // The campus photo across the top, fading into the maroon (the web sign-in page's hero)
        Box(Modifier.fillMaxWidth().height(340.dp)) {
            Image(
                painterResource(R.drawable.login_hero), null, contentScale = ContentScale.Crop,
                alignment = BiasAlignment(1f, -0.2f), modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(0f to MaroonTop.copy(alpha = .7f), .5f to MaroonTop.copy(alpha = .86f), 1f to MaroonTop),
                ),
            )
        }
    Column(
        Modifier.fillMaxSize()
            .statusBarsPadding().imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 22.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(28.dp))
        LogoTile(72)
        Spacer(Modifier.height(18.dp))
        Text("INTELLIGENT DIGITAL CAMPUS", color = Gold, style = MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(6.dp))
        Text("Holy Sai International", color = Color.White, style = MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
        Text(
            "More than a school. A smarter tomorrow.", color = Color.White.copy(alpha = .82f),
            style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp),
        )
        Spacer(Modifier.height(28.dp))
        Card(
            shape = RoundedCornerShape(24.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 10.dp),
        ) {
            Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Column {
                    Text("Welcome back", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onSurface)
                    Text("Sign in to your Smart School 360 account", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedTextField(
                    identifier, { identifier = it }, label = { Text("Email or phone") }, singleLine = true,
                    leadingIcon = { Icon(Icons.Outlined.Email, null) },
                    shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    password, { password = it }, label = { Text("Password") }, singleLine = true,
                    leadingIcon = { Icon(Icons.Outlined.Lock, null) },
                    shape = RoundedCornerShape(14.dp),
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "Show password")
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (showServer) {
                    OutlinedTextField(
                        server, { server = it }, label = { Text("Server address") }, singleLine = true,
                        supportingText = { Text("Emulator + local API: http://10.0.2.2:4000") },
                        shape = RoundedCornerShape(14.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                PrimaryButton("Sign in to Campus  →", busy = busy) { submit() }
                TextButton(onClick = { showServer = !showServer }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text(if (showServer) "Hide server settings" else "Server settings", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Spacer(Modifier.height(18.dp))
        TextButton(onClick = onTracker) {
            Icon(Icons.Outlined.MyLocation, null, tint = Gold, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Use this phone as a GPS tracker", color = Gold, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(10.dp))
        Text("Education beyond classrooms", color = Color.White.copy(alpha = .6f), style = MaterialTheme.typography.titleMedium.copy(fontFamily = Serif, fontStyle = FontStyle.Italic))
    }
    }
}

@Composable
fun HomeScreen() {
    val nav = LocalNav.current
    val user = nav.user
    val tiles = homeTiles(user)
    val greeting = when (LocalTime.now().hour) { in 0..11 -> "Good Morning"; in 12..16 -> "Good Afternoon"; else -> "Good Evening" }
    val today = remember { LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, d MMMM yyyy")) }
    val dark = isSystemInDarkTheme()

    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 32.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        // Welcome banner: the web dashboard's blush card with the campus fading in on the right
        item(span = { GridItemSpan(2) }) {
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
                    .background(if (dark) SolidColor(MaterialTheme.colorScheme.surface) else BlushGradient)
                    .border(1.dp, cardBorder, RoundedCornerShape(20.dp)),
            ) {
                Image(
                    painterResource(R.drawable.campus_banner), null, contentScale = ContentScale.Crop,
                    alignment = BiasAlignment(0.2f, 0.4f),
                    modifier = Modifier.matchParentSize().padding(start = 120.dp),
                )
                Box(
                    Modifier.matchParentSize().background(
                        Brush.horizontalGradient(
                            0f to (if (dark) MaterialTheme.colorScheme.surface else Color(0xFFFFF6F3)),
                            .5f to (if (dark) MaterialTheme.colorScheme.surface else Color(0xFFFFF4F0)).copy(alpha = .93f),
                            1f to Color.Transparent,
                        ),
                    ),
                )
                Column(Modifier.padding(20.dp, 18.dp, 20.dp, 20.dp)) {
                    Text("$greeting,", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
                    Text(user.fullName, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary, maxLines = 2)
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(shape = RoundedCornerShape(50), color = GoldTint, border = BorderStroke(1.dp, Gold.copy(alpha = .6f))) {
                            Text(
                                user.roleName, color = GoldDeep, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.CalendarToday, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(6.dp))
                        Text(today, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (hasParentPortal(user)) {
            item(span = { GridItemSpan(2) }) { ChildPicker() }
        }
        item(span = { GridItemSpan(2) }) { SectionTitle("Quick Actions") }
        itemsIndexed(tiles) { i, f ->
            Card(
                modifier = Modifier.aspectRatio(1.45f).clip(RoundedCornerShape(18.dp)).clickable { nav.go(f.route) },
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, cardBorder),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
                    IconTile(f.icon, i, 48)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(f.label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 2)
                        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        item(span = { GridItemSpan(2) }) {
            Text(
                "More options are in the ☰ menu", textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            )
        }
    }
}

/** Parent-only: choose which child the parent tiles show. */
@Composable
fun ChildPicker() {
    val parent = LocalNav.current.parent
    val state = rememberLoad(parent) { parent.load() }
    Loaded(state) { kids ->
        if (kids.size > 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                kids.forEachIndexed { i, c ->
                    FilterChip(
                        selected = parent.selected == i, onClick = { parent.selected = i },
                        label = { Text("${c.str("firstName") ?: c.str("fullName")} · ${c.str("grade").orEmpty()}") },
                    )
                }
            }
        } else if (kids.size == 1) {
            val c = kids[0]
            Text("${c.str("fullName")} · ${c.str("grade").orEmpty()}${c.str("section").orEmpty()}", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
fun ProfileScreen() {
    val nav = LocalNav.current
    val me = rememberLoad { Api.get("/api/auth/me").obj() }
    Loaded(me) { u ->
        ScreenList {
            item {
                InfoCard(u.str("fullName") ?: nav.user.fullName, subtitle = nav.user.roleName) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOfNotNull(
                            "Email" to u.str("email"),
                            "Title" to u.str("title"),
                            "Campus" to u.str("campus_name"),
                            "Academic year" to u.str("academic_year"),
                            "Server" to Session.baseUrl,
                        ).filter { it.second != null }.forEach { (k, v) -> KeyValue(k, v!!) }
                    }
                }
            }
            if (nav.user.studentId != null) {
                item { SectionTitle("My school record") }
                item { StudentRecord(nav.user.studentId) }
            }
        }
    }
}

@Composable
private fun StudentRecord(studentId: String) {
    val s = rememberLoad(studentId) { Api.get("/api/students/$studentId").obj() }
    Loaded(s) { st ->
        InfoCard(st.str("fullName") ?: "", subtitle = listOfNotNull(st.str("grade"), st.str("section"), st.str("admissionNo")).joinToString(" · ")) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                KeyValue("House", st.str("house") ?: "—")
                KeyValue("Attendance", st.str("attendance")?.let { "$it%" } ?: "—")
                KeyValue("Average", st.str("average")?.let { "$it%" } ?: "—")
                KeyValue("Bus route", st.str("busRoute") ?: "—")
                KeyValue("Date of birth", prettyDate(st.str("dateOfBirth")))
            }
        }
    }
}

@Composable
fun KeyValue(key: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(key, Modifier.weight(0.42f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(value, Modifier.weight(0.58f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}
