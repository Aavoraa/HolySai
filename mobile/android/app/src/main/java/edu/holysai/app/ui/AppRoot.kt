package edu.holysai.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import edu.holysai.app.data.Api
import edu.holysai.app.data.User
import edu.holysai.app.ui.screens.*
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import edu.holysai.app.R
import edu.holysai.app.ui.theme.Gold
import edu.holysai.app.ui.theme.Magenta
import edu.holysai.app.ui.theme.MaroonGradient
import edu.holysai.app.ui.theme.Peach
import edu.holysai.app.ui.theme.PrimaryGradient
import edu.holysai.app.ui.theme.Wine
import edu.holysai.app.ui.theme.cardBorder
import kotlinx.coroutines.launch

/** App-wide helpers every screen can reach: navigation, toasts and the signed-in user. */
class AppNav(
    val user: User,
    private val stack: MutableList<Route>,
    val snackbar: SnackbarHostState,
    val parent: ParentState,
) {
    fun go(route: Route) { stack.add(route) }
    fun back() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun home() { while (stack.size > 1) stack.removeAt(stack.lastIndex) }
    suspend fun toast(msg: String) { snackbar.showSnackbar(msg) }
}

val LocalNav = staticCompositionLocalOf<AppNav> { error("No navigation") }

/** Opens the GPS tracker, optionally with a setup code to apply. A new instance re-opens it. */
class TrackerLaunch(val setup: String? = null)

@Composable
fun AppRoot(trackerLaunch: TrackerLaunch? = null) {
    var booting by remember { mutableStateOf(true) }
    var user by remember { mutableStateOf<User?>(null) }
    var tracker by remember(trackerLaunch) { mutableStateOf(trackerLaunch) }

    tracker?.let { t ->
        BackHandler { tracker = null }
        TrackerScreen(pendingSetup = t.setup, onExit = { tracker = null })
        return
    }

    LaunchedEffect(Unit) {
        Api.onSessionExpired = { user = null }
        user = Api.restore()
        booting = false
    }

    when {
        booting -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        user == null -> LoginScreen(onSignedIn = { user = it }, onTracker = { tracker = TrackerLaunch() })
        else -> MainShell(user!!, onSignOut = { user = null })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainShell(user: User, onSignOut: () -> Unit) {
    val stack = remember(user.id) { mutableStateListOf<Route>(Route.Home) }
    val snackbar = remember { SnackbarHostState() }
    val parent = remember(user.id) { ParentState() }
    val nav = remember(user.id) { AppNav(user, stack, snackbar, parent) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val route = stack.last()

    BackHandler(enabled = drawer.isOpen || stack.size > 1) {
        if (drawer.isOpen) scope.launch { drawer.close() } else nav.back()
    }

    CompositionLocalProvider(LocalNav provides nav) {
        ModalNavigationDrawer(
            drawerState = drawer,
            drawerContent = {
                ModalDrawerSheet(drawerContainerColor = Color.Transparent, drawerShape = RoundedCornerShape(topEnd = 22.dp, bottomEnd = 22.dp)) {
                    Box(Modifier.fillMaxSize().background(MaroonGradient)) {
                        Column(Modifier.verticalScroll(rememberScrollState()).statusBarsPadding()) {
                            // Brand: the lotus on its white tile, as in the web sidebar
                            Row(Modifier.padding(20.dp, 22.dp, 20.dp, 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                LogoTile(48)
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Text("Holy Sai", color = Color.White, style = MaterialTheme.typography.headlineSmall, lineHeight = 26.sp)
                                    Text("Smart School 360", color = Color.White.copy(alpha = .75f), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            // Who is signed in
                            Row(
                                Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp))
                                    .background(Color.White.copy(alpha = .08f)).padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Initials(user.fullName, 38)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(user.fullName, color = Color.White, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(user.roleName, color = Gold, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            DrawerItem("Home", Icons.Outlined.Home, route == Route.Home) { nav.home(); scope.launch { drawer.close() } }
                            menuGroups(user).forEach { group ->
                                Text(
                                    group.title.uppercase(), style = MaterialTheme.typography.labelSmall, color = Gold.copy(alpha = .9f),
                                    modifier = Modifier.padding(start = 28.dp, end = 20.dp, top = 18.dp, bottom = 6.dp),
                                )
                                group.items.forEach { f ->
                                    DrawerItem(f.label, f.icon, route == f.route) {
                                        nav.home(); if (f.route != Route.Home) nav.go(f.route); scope.launch { drawer.close() }
                                    }
                                }
                            }
                            HorizontalDivider(Modifier.padding(horizontal = 24.dp, vertical = 14.dp), color = Color.White.copy(alpha = .12f))
                            DrawerItem("Sign out", Icons.AutoMirrored.Outlined.Logout, false) {
                                scope.launch { drawer.close(); Api.logout(); onSignOut() }
                            }
                            Spacer(Modifier.height(20.dp))
                        }
                    }
                }
            },
        ) {
            Scaffold(
                snackbarHost = { SnackbarHost(snackbar) },
                topBar = {
                    Column {
                        TopAppBar(
                            title = {
                                if (route == Route.Home) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        LogoTile(32, bordered = true)
                                        Spacer(Modifier.width(10.dp))
                                        Text("Holy Sai", style = MaterialTheme.typography.headlineSmall, color = Magenta)
                                    }
                                } else {
                                    Text(route.title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            },
                            navigationIcon = {
                                if (route == Route.Home) IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Filled.Menu, "Menu") }
                                else IconButton(onClick = { nav.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                            },
                            actions = {
                                if (route == Route.Home) {
                                    IconButton(onClick = { nav.go(Route.Notifications) }) { Icon(Icons.Outlined.Notifications, "Notifications") }
                                    Box(Modifier.padding(end = 12.dp)) { Initials(user.fullName, 34) }
                                }
                            },
                            colors = TopAppBarDefaults.topAppBarColors(
                                containerColor = MaterialTheme.colorScheme.surface, titleContentColor = MaterialTheme.colorScheme.onSurface,
                                navigationIconContentColor = MaterialTheme.colorScheme.onSurface, actionIconContentColor = MaterialTheme.colorScheme.onSurface,
                            ),
                        )
                        HorizontalDivider(color = cardBorder)
                    }
                },
                containerColor = MaterialTheme.colorScheme.background,
            ) { pad ->
                Box(Modifier.padding(pad).fillMaxSize()) { Screen(route) }
            }
        }
    }
}

/** A menu row in the maroon drawer: white text, the current page on a peach pill. */
@Composable
private fun DrawerItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    NavigationDrawerItem(
        label = { Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium) },
        icon = { Icon(icon, null, Modifier.size(21.dp)) },
        selected = selected, onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        colors = NavigationDrawerItemDefaults.colors(
            selectedContainerColor = Peach, unselectedContainerColor = Color.Transparent,
            selectedTextColor = Wine, selectedIconColor = Wine,
            unselectedTextColor = Color.White.copy(alpha = .92f), unselectedIconColor = Color.White.copy(alpha = .88f),
        ),
        modifier = Modifier.padding(horizontal = 14.dp).height(48.dp),
    )
}

/** The Holy Sai lotus on its rounded white tile (the web sidebar's brand mark). */
@Composable
fun LogoTile(size: Int, bordered: Boolean = false) {
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.26f).dp)).background(Color.White)
            .let { if (bordered) it.border(1.dp, cardBorder, RoundedCornerShape((size * 0.26f).dp)) else it }
            .padding((size * 0.12f).dp),
        contentAlignment = Alignment.Center,
    ) {
        Image(painterResource(R.drawable.logo_mark), "Holy Sai", contentScale = ContentScale.Fit)
    }
}

/** Initials in a wine circle, like the web's profile avatar. */
@Composable
fun Initials(name: String, size: Int) {
    val letters = name.split(' ').filter { it.isNotBlank() }.let { p -> (p.firstOrNull()?.take(1).orEmpty() + (if (p.size > 1) p.last().take(1) else "")).uppercase() }
    Box(Modifier.size(size.dp).clip(CircleShape).background(PrimaryGradient), contentAlignment = Alignment.Center) {
        Text(letters, color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size * 0.36f).sp)
    }
}

@Composable
private fun Screen(route: Route) {
    when (route) {
        Route.Home -> HomeScreen()
        Route.MyAttendance -> MyAttendanceScreen()
        Route.Leave -> LeaveScreen()
        Route.Notifications -> NotificationsScreen()
        Route.Tasks -> TasksScreen()
        Route.Profile -> ProfileScreen()
        Route.MarkAttendance -> SectionsScreen()
        is Route.Register -> RegisterScreen(route.sectionId)
        Route.Homework -> HomeworkScreen()
        Route.NewHomework -> NewHomeworkScreen()
        Route.Marks -> AssessmentsScreen()
        is Route.MarksEntry -> MarksEntryScreen(route.assessmentId)
        Route.Signals -> SignalsScreen()
        is Route.Signal -> SignalScreen(route.id)
        Route.ChildTrack -> ChildTrackScreen()
        Route.ChildToday -> ChildTodayScreen()
        Route.ChildHomework -> ChildHomeworkScreen()
        Route.ChildFees -> ChildFeesScreen()
        Route.Circulars -> CircularsScreen()
        Route.GateLog -> GateLogScreen()
        Route.Boarding -> BoardingScreen()
        is Route.BoardingRoute -> BoardingRouteScreen(route.routeId)
        Route.Visitors -> VisitorsScreen()
        Route.Pulse -> PulseScreen()
        Route.LeaveApprovals -> LeaveApprovalsScreen()
        is Route.Generic -> GenericScreen(route)
    }
}
