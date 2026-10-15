// @ts-nocheck
/* Ported verbatim from the approved wireframe (assets/js/icons.js). */
const HS: any = {};
/* ==========================================================================
   ICONS — single stroke-based set (24x24 viewBox), no emoji anywhere in UI
   Usage: icon('users', 18)  ->  '<svg …>…</svg>'
   ========================================================================== */
(function (HS) {
  'use strict';

  var P = {
    /* navigation & structure */
    grid:        '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    pulse:       '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    bell:        '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    check:       '<path d="M20 6 9 17l-5-5"/>',
    checkSquare: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    users:       '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user:        '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userCheck:   '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    idCard:      '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8.5" cy="11" r="2.5"/><path d="M4.5 17.5c.8-1.6 2.3-2.5 4-2.5s2.9.9 3.7 2.5"/><path d="M15 9h5M15 13h5"/>',
    calendar:    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock:       '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    chart:       '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
    barChart:    '<path d="M12 20V10M18 20V4M6 20v-4"/>',
    trending:    '<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
    target:      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    book:        '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    bookOpen:    '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    graduation:  '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
    clipboard:   '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    edit:        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    file:        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    fileText:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    folder:      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    award:       '<circle cx="12" cy="8" r="6"/><path d="m8.2 13.4-1.4 7.2 5.2-2.6 5.2 2.6-1.4-7.2"/>',
    star:        '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21l1.2-6.9-5-4.9 6.9-1z"/>',
    heart:       '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21.2l7.7-7.8 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    shield:      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    alert:       '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    alertCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
    info:        '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    helpCircle:  '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    bus:         '<path d="M4 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11"/><path d="M4 11h16"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M4 17h2M18 17h2M8 4v3M16 4v3"/>',
    mapPin:      '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    route:       '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h5"/>',
    navigation:  '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
    door:        '<path d="M3 21h18"/><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><circle cx="14.5" cy="12" r="1"/>',
    scan:        '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
    camera:      '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    wallet:      '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    rupee:       '<path d="M6 3h12M6 8h12M16.5 3c0 5-3.5 5-7 5h-.5l8 13"/>',
    receipt:     '<path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    creditCard:  '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    briefcase:   '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    building:    '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    box:         '<path d="m21 8-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    tool:        '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 21a2 2 0 0 1-3 0l-6.5-6.5a4 4 0 0 0-5-5L3 4a2 2 0 0 1 3-3z"/>',
    wrench:      '<path d="M14.7 6.3a4 4 0 1 0 4.6 4.6l-2.8 2.8-4.6-4.6z"/><path d="m12 9-8 8a2.1 2.1 0 0 0 3 3l8-8"/>',
    lightbulb:   '<path d="M9 18h6M10 22h4"/><path d="M12 2a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 2z"/>',
    rocket:      '<path d="M5 13c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.9-.9.9-2.2 0-3s-2.2-.9-3 0z"/><path d="M15 9a9 9 0 0 0 6-7 9 9 0 0 0-7 6L9 13l2 2z"/><path d="m9 13-3-1 3.5-3.5"/><path d="m11 15 1 3 3.5-3.5"/>',
    sparkle:     '<path d="M12 2.5 14 9l6.5 2-6.5 2-2 6.5-2-6.5L3.5 11 10 9z"/><path d="M19 3v3M17.5 4.5h3"/>',
    brain:       '<path d="M9.5 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6 17a3 3 0 0 0 3.5 3V3z"/><path d="M14.5 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 18 17a3 3 0 0 1-3.5 3V3z"/>',
    message:     '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 8.5-8.4A8.4 8.4 0 0 1 21 11.5z"/>',
    send:        '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    mail:        '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
    phone:       '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    megaphone:   '<path d="m3 11 15-7v16L3 13z"/><path d="M3 11H2a1 1 0 0 0-1 1v0a1 1 0 0 0 1 1h1"/><path d="M7 14v5a2 2 0 0 0 4 0v-3.5"/>',
    search:      '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    filter:      '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
    download:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    upload:      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    plus:        '<path d="M12 5v14M5 12h14"/>',
    minus:       '<path d="M5 12h14"/>',
    x:           '<path d="M18 6 6 18M6 6l12 12"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight:'<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronsLeft: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
    trophy:      '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    chevronUp:   '<path d="m18 15-6-6-6 6"/>',
    arrowRight:  '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft:   '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    arrowUp:     '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown:   '<path d="M12 5v14M18 13l-6 6-6-6"/>',
    external:    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    more:        '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
    menu:        '<path d="M3 6h18M3 12h18M3 18h18"/>',
    settings:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    globe:       '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    lock:        '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    logout:      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    refresh:     '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
    eye:         '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    play:        '<path d="m6 3 14 9-14 9z"/>',
    pause:       '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    home:        '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    layers:      '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    list:        '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    flag:        '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    thermometer: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>',
    activity:    '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    zap:         '<path d="M13 2 3 14h8l-1 8 10-12h-8z"/>',
    link:        '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    key:         '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 9-9M17 6l2.5 2.5M14 9l2.5 2.5"/>',
    hash:        '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    percent:     '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    pieChart:    '<path d="M21.2 15.9A10 10 0 1 1 8.1 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    sun:         '<circle cx="12" cy="12" r="4.5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon:        '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    save:        '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    trash:       '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    copy:        '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    printer:     '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    qr:          '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/>',
    stethoscope: '<path d="M6 2v6a4 4 0 0 0 8 0V2"/><path d="M6 2H4M14 2h2M10 12v3a5 5 0 0 0 10 0v-1"/><circle cx="20" cy="11" r="2"/>',
    truck:       '<path d="M2 17V6a1 1 0 0 1 1-1h11v12"/><path d="M14 9h4l3 3v5h-7"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/>',
    compass:     '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5.5-5.5 2 2-5.5z"/>',
    puzzle:      '<path d="M9 3a2 2 0 0 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 0 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 0 0-4 0v1H6a1 1 0 0 1-1-1v-3H4a2 2 0 0 1 0-4h1V5a1 1 0 0 1 1-1h3z"/>',
    lotus:       '<path d="M12 3c1 3.5 3 5.5 5 7.5-2 0-3.6-.5-5-2-1.4 1.5-3 2-5 2 2-2 4-4 5-7.5z"/><path d="M12 9c2 2.6 4.5 4.3 7 5-2.2.8-4.5.3-6.2-1-1.1-.9-1.6-2.1-.8-4z"/><path d="M12 9c-2 2.6-4.5 4.3-7 5 2.2.8 4.5.3 6.2-1 1.1-.9 1.6-2.1.8-4z"/><path d="M12 15c3.5 1.5 6.5 1.2 9.5-.5-2.2 2.2-5 3.2-8.5 2.5-1-.2-1-.2-1-2z"/><path d="M12 15c-3.5 1.5-6.5 1.2-9.5-.5 2.2 2.2 5 3.2 8.5 2.5 1-.2 1-.2 1-2z"/><path d="M6 21c4 1.5 8 1.5 12 0-3 1.2-9 1.2-12 0z"/>'
  };

  HS.icon = function (name, size, cls) {
    var d = P[name] || P.circleFallback || '<circle cx="12" cy="12" r="9"/>';
    var s = size || 18;
    return '<svg class="' + (cls || '') + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };

  /* Full-fidelity Lotus emblem in brand gradient (Magenta + Gold) */
  HS.lotus = function (size, opts) {
    var s = size || 36;
    opts = opts || {};
    var id = 'lotus-grad-' + Math.floor(Math.random() * 10000);
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 100 85" fill="none" role="img" aria-label="Holy Sai Lotus" class="' + (opts.cls || '') + '">' +
      '<defs>' +
      '<linearGradient id="' + id + '-m" x1="0%" y1="0%" x2="0%" y2="100%">' +
      '<stop offset="0%" stop-color="#E60055"/><stop offset="50%" stop-color="#B30042"/><stop offset="100%" stop-color="#7A0029"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + id + '-g" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="#FFF0BE"/><stop offset="100%" stop-color="#FEDB6E"/>' +
      '</linearGradient>' +
      '</defs>' +
      /* Central tallest petal */
      '<path d="M50 4 C53 18, 59 28, 67 38 C57 37, 50 31, 50 25 C50 31, 43 37, 33 38 C41 28, 47 18, 50 4 Z" fill="url(#' + id + '-m)" stroke="url(#' + id + '-g)" stroke-width="1.2"/>' +
      /* Inner left & right high petals */
      '<path d="M50 22 C58 32, 69 40, 80 43 C70 47, 59 44, 52 38 C50 35, 49 28, 50 22 Z" fill="url(#' + id + '-m)" stroke="url(#' + id + '-g)" stroke-width="1"/>' +
      '<path d="M50 22 C42 32, 31 40, 20 43 C30 47, 41 44, 48 38 C50 35, 51 28, 50 22 Z" fill="url(#' + id + '-m)" stroke="url(#' + id + '-g)" stroke-width="1"/>' +
      /* Mid side petals */
      '<path d="M50 36 C64 43, 78 45, 93 41 C82 51, 68 53, 53 48 C50 45, 49 40, 50 36 Z" fill="url(#' + id + '-m)" stroke="url(#' + id + '-g)" stroke-width="1"/>' +
      '<path d="M50 36 C36 43, 22 45, 7 41 C18 51, 32 53, 47 48 C50 45, 51 40, 50 36 Z" fill="url(#' + id + '-m)" stroke="url(#' + id + '-g)" stroke-width="1"/>' +
      /* Lower wide base petals */
      '<path d="M50 48 C68 54, 82 54, 96 48 C83 60, 66 62, 50 58 C34 62, 17 60, 4 48 C18 54, 32 54, 50 48 Z" fill="url(#' + id + '-m)" stroke="url(#' + id + '-g)" stroke-width="1"/>' +
      /* Water ripples / waves */
      '<path d="M30 68 C38 65, 44 71, 52 68 C60 65, 66 70, 72 67" stroke="url(#' + id + '-g)" stroke-width="2" stroke-linecap="round" fill="none"/>' +
      '<path d="M22 76 C34 72, 42 80, 54 76 C66 72, 74 78, 82 74" stroke="url(#' + id + '-g)" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
      '</svg>';
  };

  /* Brand divider motif (gold line with small center lotus) */
  HS.brandDivider = function (width) {
    var w = width || '100%';
    return '<div class="row center g-3" style="width:' + w + ';margin:10px auto">' +
      '<span style="flex:1;height:1px;background:linear-gradient(90deg, transparent, #FEDB6E)"></span>' +
      HS.lotus(18) +
      '<span style="flex:1;height:1px;background:linear-gradient(270deg, transparent, #FEDB6E)"></span>' +
      '</div>';
  };

  HS.iconNames = Object.keys(P);
  HS.iconPaths = P;
})(HS);

export const icon: (name: string, size?: number, cls?: string) => string = HS.icon;
export const lotus: (size?: number) => string = HS.lotus;
export const brandDivider: (width?: string) => string = HS.brandDivider;
export const iconNames: string[] = HS.iconNames;
export const iconPaths: Record<string, string> = HS.iconPaths;
