#!/usr/bin/env python3
"""
Run as:  python3 patch_admin.py admin.html
Produces: admin_patched.html
"""
import re, sys

src = sys.argv[1] if len(sys.argv) > 1 else 'admin.html'
with open(src, 'r', encoding='utf-8') as f:
    html = f.read()

errors = []

# ── CHANGE 1a: Split thead Name → Last Name + First Name, add sort icons ─────
OLD_THEAD = '<thead><tr><th>Name</th><th>Team Name</th><th>Email</th><th>Players</th><th>Round Extras</th><th>Amount</th><th>Status</th><th>Date</th><th></th></tr></thead>'
NEW_THEAD = """<thead><tr>
                  <th onclick="sortRegs('lastName')"  style="cursor:pointer;user-select:none;white-space:nowrap;">Last Name <span id="sort-icon-lastName"></span></th>
                  <th onclick="sortRegs('firstName')" style="cursor:pointer;user-select:none;white-space:nowrap;">First Name <span id="sort-icon-firstName"></span></th>
                  <th>Team Name</th><th>Email</th><th>Players</th><th>Round Extras</th><th>Amount</th>
                  <th onclick="sortRegs('date')" style="cursor:pointer;user-select:none;white-space:nowrap;">Date <span id="sort-icon-date">&#x2193;</span></th>
                  <th>Status</th><th></th>
                </tr></thead>"""
if OLD_THEAD in html:
    html = html.replace(OLD_THEAD, NEW_THEAD, 1)
    print("OK Change 1a: thead updated")
else:
    errors.append("FAIL Change 1a: thead not found")

# ── CHANGE 1b: Fix loading placeholder colspan 9 -> 10 ───────────────────────
OLD_LOAD = '<tr><td colspan="9" class="empty-table"><div class="empty-icon">\U0001f3cc\ufe0f</div>Loading registrations\u2026</td></tr>'
NEW_LOAD = '<tr><td colspan="10" class="empty-table"><div class="empty-icon">\U0001f3cc\ufe0f</div>Loading registrations\u2026</td></tr>'
if OLD_LOAD in html:
    html = html.replace(OLD_LOAD, NEW_LOAD, 1)
    print("OK Change 1b: loading colspan fixed")
else:
    print("NOTE: loading placeholder not found (may already be fixed or use different encoding)")

# ── CHANGE 2: Insert sort vars + helpers before _loadedRegs ──────────────────
ANCHOR = 'var _loadedRegs = [];\nvar _loadedSponsors = [];'
SORT_BLOCK = (
    "// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n"
    "// REG TABLE SORT\n"
    "// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n"
    "var _regSortKey = 'date';\n"
    "var _regSortDir = -1; // -1 = newest first, 1 = oldest first\n"
    "\n"
    "function sortRegs(key) {\n"
    "  if (_regSortKey === key) { _regSortDir *= -1; }\n"
    "  else { _regSortKey = key; _regSortDir = key === 'date' ? -1 : 1; }\n"
    "  renderRegistrations(_loadedRegs);\n"
    "}\n"
    "\n"
    "function updateSortIcons() {\n"
    "  ['lastName','firstName','date'].forEach(function(k) {\n"
    "    var el = document.getElementById('sort-icon-' + k);\n"
    "    if (!el) return;\n"
    "    el.textContent = _regSortKey === k ? (_regSortDir === 1 ? ' \u2191' : ' \u2193') : '';\n"
    "  });\n"
    "}\n"
    "\n"
)
if ANCHOR in html:
    html = html.replace(ANCHOR, SORT_BLOCK + ANCHOR, 1)
    print("OK Change 2: sort vars inserted")
else:
    errors.append("FAIL Change 2: _loadedRegs anchor not found")

# ── CHANGE 3: Replace renderRegistrations entirely ───────────────────────────
NEW_FN = (
"function renderRegistrations(orders){\n"
"  if (orders !== _loadedRegs) {\n"
"    _loadedRegs = (orders || []).filter(function(o){\n"
"      return o && (o.type === 'registration' || o.type === 'team' || o.type === 'individual' ||\n"
"                   o.type === 'sponsor-team' || o.type === 'comped-team' || o.golfers);\n"
"    });\n"
"  }\n"
"\n"
"  // Sort\n"
"  var sorted = _loadedRegs.slice().sort(function(a, b) {\n"
"    var aVal, bVal;\n"
"    if (_regSortKey === 'lastName') {\n"
"      aVal = (a.lastName || '').toLowerCase();\n"
"      bVal = (b.lastName || '').toLowerCase();\n"
"    } else if (_regSortKey === 'firstName') {\n"
"      aVal = (a.firstName || '').toLowerCase();\n"
"      bVal = (b.firstName || '').toLowerCase();\n"
"    } else {\n"
"      aVal = a.created ? String(a.created) : (a.createdAt || a.date || '');\n"
"      bVal = b.created ? String(b.created) : (b.createdAt || b.date || '');\n"
"    }\n"
"    if (aVal < bVal) return -1 * _regSortDir;\n"
"    if (aVal > bVal) return  1 * _regSortDir;\n"
"    return 0;\n"
"  });\n"
"\n"
"  var tbody = document.getElementById('reg-tbody');\n"
"  if (!_loadedRegs.length) {\n"
r"    tbody.innerHTML = '<tr><td colspan=\"10\" class=\"empty-table\"><div class=\"empty-icon\">\uD83C\uDFCC\uFE0F</div>No registrations yet</td></tr>';"
"\n"
"    updateRegStats(_loadedRegs); updateSortIcons(); return;\n"
"  }\n"
"\n"
"  tbody.innerHTML = sorted.map(function(r){\n"
"    var origIdx = _loadedRegs.indexOf(r);\n"
"    var isSponsorTeam = (r.type === 'sponsor-team');\n"
"    var srcBadge = isSponsorTeam\n"
"      ? ' <span style=\"font-size:9px;background:#e8f4ea;color:#1b5e20;padding:1px 5px;border-radius:3px;vertical-align:middle;border:1px solid #a5d6a7;\">sponsor</span>'\n"
"      : (r.source === 'manual' ? ' <span style=\"font-size:9px;background:#f0f2ef;color:var(--tl);padding:1px 5px;border-radius:3px;vertical-align:middle;\">manual</span>' : '');\n"
"    var firstName = r.firstName || '\u2014';\n"
"    var lastName  = r.lastName  || '';\n"
"    var players   = r.playerCount || (r.golfers && r.golfers.length) || 1;\n"
"    var addons    = (Array.isArray(r.addons) ? r.addons : (typeof r.addons === 'string' && r.addons && r.addons !== 'none' ? r.addons.split(',') : [])).map(function(a){return a.name||a;}).join(', ') || '\u2014';\n"
"    var amt       = normAmt(r) ? fmtMoney(normAmt(r)) : '\u2014';\n"
"    var status    = r.status || r.paymentStatus || 'paid';\n"
"    var teamName  = r.teamName || '';\n"
"    var rawDate   = r.created ? new Date(r.created*1000) : (r.createdAt ? new Date(r.createdAt) : (r.date ? new Date(r.date) : null));\n"
"    var date      = rawDate ? rawDate.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '\u2014';\n"
"    var teamsCount = isSponsorTeam ? Math.ceil((r.playerCount||4)/4) : '';\n"
"    var playersDisplay = isSponsorTeam\n"
"      ? (teamsCount + ' team' + (teamsCount!==1?'s':'') + ' (' + (r.playerCount||4) + ' golfers)')\n"
"      : players;\n"
"    var editBtn = isSponsorTeam\n"
"      ? '<button class=\"btn btn-outline btn-sm\" onclick=\"alert(\\'Edit this entry via the Sponsors tab.\\')\">&#x1F517; Sponsor</button>'\n"
"      : '<button class=\"btn btn-outline btn-sm\" onclick=\"openEditEntry(\\'registration\\',' + origIdx + ')\">&#x270F; Edit</button>'\n"
"        + ' <button class=\"btn btn-outline btn-sm\" onclick=\"resendConfirmation(\\'' + escH(r.id||'') + '\\',this)\" title=\"Resend confirmation email\">&#x2709;</button>'\n"
"        + ' <button class=\"btn btn-outline btn-sm\" onclick=\"sendUpsellEmail(\\'' + escH(r.id||'') + '\\',this)\" title=\"Send add-on upsell email\">&#x1F4E9;</button>'\n"
"        + ' <button class=\"btn btn-danger btn-sm\" onclick=\"deleteEntry(\\'registrations\\',\\'' + escH(r.id||'') + '\\',' + origIdx + ')\">&#x2715;</button>';\n"
"    return '<tr' + (isSponsorTeam?' style=\"background:rgba(232,244,234,0.35);\"':'') + '>'\n"
"      + '<td><strong>' + escH(lastName) + '</strong>' + (isSponsorTeam ? srcBadge : '') + '</td>'\n"
"      + '<td>' + escH(firstName) + (!isSponsorTeam ? srcBadge : '') + '</td>'\n"
"      + '<td style=\"font-size:12px;color:var(--tl);\">' + escH(teamName||'\u2014') + '</td>'\n"
"      + '<td>' + escH(r.email||'\u2014') + '</td>'\n"
"      + '<td>' + playersDisplay + '</td>'\n"
"      + '<td style=\"font-size:11px;color:var(--tl)\">' + escH(addons) + '</td>'\n"
"      + '<td>' + amt + '</td>'\n"
"      + '<td>' + date + '</td>'\n"
"      + '<td><span class=\"status-pill status-' + escH(status) + '\">' + escH(status) + '</span></td>'\n"
"      + '<td style=\"white-space:nowrap;\">' + editBtn + '</td>'\n"
"      + '</tr>';\n"
"  }).join('');\n"
"\n"
"  updateRegStats(_loadedRegs);\n"
"  updateSortIcons();\n"
"  document.getElementById('cnt-regs').textContent = _loadedRegs.length;\n"
"}"
)

pattern = r"function renderRegistrations\(orders\)\{.*?document\.getElementById\('cnt-regs'\)\.textContent = _loadedRegs\.length;\n\}"
m = re.search(pattern, html, re.DOTALL)
if m:
    html = html[:m.start()] + NEW_FN + html[m.end():]
    print("OK Change 3: renderRegistrations replaced")
else:
    errors.append("FAIL Change 3: renderRegistrations not found")

# ── Output ────────────────────────────────────────────────────────────────────
if errors:
    print("\nERRORS — patch incomplete:")
    for e in errors:
        print(" ", e)
    sys.exit(1)
else:
    out = src.replace('.html', '_patched.html')
    if out == src:
        out = 'admin_patched.html'
    with open(out, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"\nDone! Saved to: {out}")
