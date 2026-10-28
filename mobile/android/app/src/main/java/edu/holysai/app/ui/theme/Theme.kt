package edu.holysai.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import edu.holysai.app.R

// Holy Sai palette, the same tokens as the web app (frontend/src/styles/premium.css)
val Magenta = Color(0xFF990033)          // the one action colour
val MagentaHover = Color(0xFF7E0A35)
val MagentaDeep = Color(0xFF4C0923)      // menu and headers
val MaroonTop = Color(0xFF5E0C2C)
val MaroonBottom = Color(0xFF3F071D)
val MagentaTint = Color(0xFFF8EDF0)
val Peach = Color(0xFFFFE6DE)            // the current menu item
val PeachDeep = Color(0xFFF9CEC4)
val Wine = Color(0xFF5A0B26)             // text on peach
val Gold = Color(0xFFE4C27A)             // champagne accent on dark surfaces
val GoldDeep = Color(0xFF855F12)         // gold text on light surfaces (5.4:1)
val GoldTint = Color(0xFFFBF5E8)
val Ivory = Color(0xFFF8F5F2)
val Ink = Color(0xFF22161B)              // strong text
val InkSoft = Color(0xFF43373C)          // body text
val Muted = Color(0xFF6E6166)            // secondary text (5.8:1)
val Hairline = Color(0xFFEFE6E3)         // card borders
val Teal = Color(0xFF167A55)             // status colours double as text: all ≥ 4.5:1 on white
val Amber = Color(0xFF94600A)
val Danger = Color(0xFFC0284A)

/** Muted icon hues for tiles and quick actions, as on the web dashboard. */
val TileHues = listOf(
    Color(0xFF990033) to Color(0xFFF8EDF0),  // brand
    Color(0xFF3E6E9E) to Color(0xFFEAF1F8),  // blue
    Color(0xFF7A4E8C) to Color(0xFFF3EDF6),  // plum
    Color(0xFF2F6A4C) to Color(0xFFEAF4EE),  // sage
    Color(0xFF855A0B) to Color(0xFFFAF2E1),  // amber
    Color(0xFF56657A) to Color(0xFFEEF1F4),  // steel
)

val MaroonGradient = Brush.verticalGradient(listOf(MaroonTop, MagentaDeep, MaroonBottom))
val PeachGradient = Brush.horizontalGradient(listOf(Peach, PeachDeep))
val PrimaryGradient = Brush.verticalGradient(listOf(Color(0xFFA5143F), Color(0xFF8C0A35)))
val BlushGradient = Brush.linearGradient(listOf(Color(0xFFFFF8F6), Color(0xFFFFF1EC), Color(0xFFFDE9E2)))

@OptIn(ExperimentalTextApi::class)
private fun jakarta(weight: Int) =
    Font(R.font.plus_jakarta_sans, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

@OptIn(ExperimentalTextApi::class)
private fun cormorant(weight: Int) =
    Font(R.font.cormorant_garamond, FontWeight(weight), variationSettings = FontVariation.Settings(FontVariation.weight(weight)))

/** Interface face: Plus Jakarta Sans. */
val Sans = FontFamily(jakarta(400), jakarta(500), jakarta(600), jakarta(700), jakarta(800))

/** Greetings, page titles and quotes: Cormorant Garamond. */
val Serif = FontFamily(cormorant(500), cormorant(600), cormorant(700))

private val Base = Typography()

private val AppType = Typography(
    displaySmall = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 36.sp, lineHeight = 40.sp),
    headlineLarge = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 38.sp),
    headlineMedium = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 30.sp, lineHeight = 34.sp),
    headlineSmall = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 30.sp),
    titleLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 19.sp, lineHeight = 25.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 21.sp),
    titleSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 18.sp),
    bodyLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 10.sp, lineHeight = 14.sp, letterSpacing = 1.6.sp),
    displayLarge = Base.displayLarge.copy(fontFamily = Serif),
    displayMedium = Base.displayMedium.copy(fontFamily = Serif),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(22.dp),
)

private val Light = lightColorScheme(
    primary = Magenta,
    onPrimary = Color.White,
    primaryContainer = MagentaTint,
    onPrimaryContainer = Wine,
    secondary = GoldDeep,
    onSecondary = Color.White,
    secondaryContainer = GoldTint,
    onSecondaryContainer = Color(0xFF5A3C00),
    tertiary = Teal,
    background = Ivory,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF2EDE9),
    onSurfaceVariant = Muted,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFBF9F7),
    surfaceContainer = Color(0xFFF7F3F0),
    surfaceContainerHigh = Color(0xFFF2EDE9),
    outline = Color(0xFFDCD1CC),
    outlineVariant = Hairline,
    error = Danger,
)

private val Dark = darkColorScheme(
    primary = Color(0xFFE0467A),
    onPrimary = Color(0xFF2A0614),
    primaryContainer = Color(0xFF4C0923),
    onPrimaryContainer = Color(0xFFFFD9E2),
    secondary = Gold,
    onSecondary = Color(0xFF2A1A00),
    secondaryContainer = Color(0xFF4A3500),
    onSecondaryContainer = Gold,
    tertiary = Color(0xFF3CC08A),
    background = Color(0xFF110B0D),
    onBackground = Color(0xFFF7F2F4),
    surface = Color(0xFF181114),
    onSurface = Color(0xFFF7F2F4),
    surfaceVariant = Color(0xFF231A1E),
    onSurfaceVariant = Color(0xFFA89CA1),
    surfaceContainerLow = Color(0xFF1D1418),
    surfaceContainer = Color(0xFF21171B),
    surfaceContainerHigh = Color(0xFF2A1F24),
    outline = Color(0xFF3F3036),
    outlineVariant = Color(0xFF2E2227),
    error = Color(0xFFF0697A),
)

/** Card border: the warm hairline in light mode, a quiet line in dark mode. */
val cardBorder: Color
    @Composable @ReadOnlyComposable get() = MaterialTheme.colorScheme.outlineVariant

@Composable
fun HolySaiTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) Dark else Light,
        typography = AppType,
        shapes = AppShapes,
        content = content,
    )
}
