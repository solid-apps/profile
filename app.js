// profile — a Solid app that maintains a pod's identity in three projections:
//   /profile/card.jsonld         — the WebID. Source of truth. Identity + soul:* fields.
//   /settings/publicTypeIndex.jsonld — endpoint registrations (which app at which URL).
//   /profile/SOUL.md             — generated markdown for agents that prefer plain text.
//
// One source (card.jsonld) → one editor → two outputs (card + SOUL.md). The
// typeIndex is read for endpoint discovery; for v0 it's not edited from here.

const POD = location.origin
const CARD_URL = `${POD}/profile/card.jsonld`
const SOUL_URL = `${POD}/profile/SOUL.md`
const TYPE_INDEX_URL = `${POD}/settings/publicTypeIndex.jsonld`
const APPS_CONTAINER = `${POD}/public/apps/`
const AVATAR_URL = `${POD}/profile/avatar.png`

const ctx = {
  card: null,         // parsed JSON-LD
  editable: false,    // user is the pod owner
  dirty: false,
  // Use the Solid OIDC session (set by xlogin.js) when available, otherwise
  // fall back to plain fetch with credentials — that covers the common case
  // of being signed into the same-origin JSS pod via cookie.
  fetch: (...args) => (window.solid?.session?.fetch || window.fetch)(...args),
}

// ---------- Boot ----------

async function boot() {
  const app = document.getElementById('app')

  ctx.editable = await detectOwner()

  let card
  try {
    const r = await ctx.fetch(CARD_URL, { credentials: 'include' })
    if (r.ok) card = await r.json()
  } catch {}

  if (!card) {
    app.classList.remove('loading')
    if (ctx.editable) openWizard()
    else renderEmpty()
    return
  }

  ctx.card = card
  app.classList.remove('loading')

  // JSS auto-seeds card.jsonld with just foaf:name="me" on first boot.
  // If we land on that stub and the owner is signed in, jump straight to
  // the wizard — saves them hunting for click-to-edit affordances on an
  // otherwise empty page.
  if (ctx.editable && isStubCard(card)) {
    openWizard()
    return
  }

  render()
  renderAgentView()
  loadInstalledApps()
}

function isStubCard(c) {
  if (!c) return true
  const meaningful = [
    'schema:description', 'description',
    'schema:alternateName', 'alternateName',
    'foaf:img', 'schema:image', 'image',
    'schema:url', 'url',
    'soul:values', 'soul:hardLimits', 'soul:commsStyle', 'soul:memoryPolicy',
  ]
  return !meaningful.some(k => c[k])
}

// ---------- Auth detection ----------

async function detectOwner() {
  try {
    const r = await ctx.fetch(`${POD}/profile/`, {
      method: 'HEAD',
      credentials: 'include',
    })
    const wacAllow = r.headers.get('WAC-Allow') || ''
    // WAC-Allow: user="read write append control"
    return /user="[^"]*\bwrite\b/.test(wacAllow)
  } catch {
    return false
  }
}

// ---------- Render: human view ----------

function render() {
  const c = ctx.card
  setField('foaf:name', c['foaf:name'] || c.name)
  setField('schema:alternateName', c['schema:alternateName'] || c.alternateName)
  setField('schema:description', c['schema:description'] || c.description)

  // Avatar: only attempt to load if an explicit image URL is in the card.
  // Otherwise show a clean initials circle — no 404 noise, looks intentional.
  const img = c['foaf:img'] || c.image || c['schema:image']
  const avatarEl = document.getElementById('avatar')
  const fallbackEl = document.getElementById('avatarFallback')
  if (img) {
    avatarEl.src = img
    avatarEl.hidden = false
    fallbackEl.style.display = 'none'
    avatarEl.onerror = function () {
      this.hidden = true
      fallbackEl.style.display = ''
    }
  } else {
    avatarEl.hidden = true
    fallbackEl.style.display = ''
  }
  fallbackEl.textContent = initial(c['foaf:name'] || c.name)

  renderLinks(c['schema:url'] || c.url || [])

  if (ctx.editable) {
    document.querySelectorAll('[data-field]').forEach(el => {
      el.setAttribute('contenteditable', 'true')
      el.addEventListener('blur', onFieldBlur)
    })
    document.getElementById('addLink').hidden = false
    document.getElementById('addLink').addEventListener('click', onAddLink)
    document.getElementById('avatar').classList.add('editable')
    document.getElementById('avatarFallback').classList.add('editable')
    document.getElementById('avatar').addEventListener('click', triggerAvatarUpload)
    document.getElementById('avatarFallback').addEventListener('click', triggerAvatarUpload)
    document.getElementById('cover').classList.add('editable')

    // First-time edit hint — fades on first interaction, persists per pod.
    if (!localStorage.getItem('profile:edit-hint-seen')) {
      const hint = document.getElementById('editHint')
      hint.hidden = false
      const dismiss = () => {
        hint.classList.add('fade-out')
        localStorage.setItem('profile:edit-hint-seen', '1')
      }
      document.querySelectorAll('[data-field]').forEach(el => {
        el.addEventListener('focus', dismiss, { once: true })
      })
    }
  }
}

function initial(name) {
  if (!name) return '·'
  const ch = name.trim().charAt(0)
  return ch ? ch.toUpperCase() : '·'
}

function setField(field, value) {
  const el = document.querySelector(`[data-field="${field}"]`)
  if (!el) return
  el.textContent = value || ''
  if (!value) el.classList.add('empty')
  else el.classList.remove('empty')
}

function renderLinks(urls) {
  const list = document.getElementById('linkList')
  list.innerHTML = ''
  const arr = Array.isArray(urls) ? urls : (urls ? [urls] : [])
  for (const url of arr) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = url
    a.textContent = shortLink(url)
    a.target = '_blank'
    a.rel = 'noopener'
    li.appendChild(a)
    if (ctx.editable) {
      const rm = document.createElement('button')
      rm.className = 'remove-link'
      rm.textContent = '×'
      rm.title = 'Remove'
      rm.addEventListener('click', () => removeLink(url))
      li.appendChild(rm)
    }
    list.appendChild(li)
  }
}

function shortLink(url) {
  try {
    const u = new URL(url)
    if (u.protocol === 'nostr:') return 'nostr:' + u.pathname.slice(0, 16) + '…'
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

function renderEmpty() {
  document.querySelector('.human-view').hidden = true
  const empty = document.getElementById('emptyState')
  empty.hidden = false

  // Tailor the message + button based on whether we're inside a pod
  // (same-origin sign-in works) vs. served standalone from a static host
  // (e.g. solid-apps.github.io — user needs to pick a pod via xlogin).
  const onPod = isLikelyPod()
  const sub = document.getElementById('emptySub')
  const btn = document.getElementById('signInBtn')

  if (onPod) {
    sub.textContent = 'Sign in as the pod owner to create one.'
    btn.textContent = 'Sign in'
    btn.addEventListener('click', () => {
      const returnTo = encodeURIComponent(location.pathname + location.search)
      location.href = `${POD}/signin?returnTo=${returnTo}`
    }, { once: true })
  } else {
    sub.textContent = 'This is the standalone view. Connect your pod to load (or create) your profile.'
    btn.textContent = 'Connect your pod'
    btn.addEventListener('click', async () => {
      // Lazy-load xlogin only when the standalone user actually needs it.
      // On a pod we use /signin and never touch xlogin, which keeps the
      // /idp/token 401 noise out of the console.
      await loadScript('xlogin.js')
      document.querySelector('.xl-btn')?.click()
    }, { once: true })
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

function isLikelyPod() {
  // Heuristic: a JSS pod responds at /idp/ (the OIDC issuer) with 200/302.
  // We can't do that synchronously here — instead use a coarse proxy: if
  // location.host looks like a github.io / netlify / vercel / pages.dev
  // domain, treat as standalone; otherwise assume pod. Refined in v0.1
  // with an actual /idp/ probe at boot.
  const h = location.host
  return !/\.(github|netlify|vercel|pages)\.(io|app|dev)$/i.test(h)
}

// ---------- Editing ----------

function onFieldBlur(e) {
  const el = e.currentTarget
  const field = el.getAttribute('data-field')
  const value = el.textContent.trim()
  if (ctx.card[field] === value) return
  ctx.card[field] = value || undefined
  scheduleSave()
}

function onAddLink() {
  const url = prompt('Link URL?')
  if (!url) return
  const list = ctx.card['schema:url']
  const arr = Array.isArray(list) ? list : (list ? [list] : [])
  if (arr.includes(url)) return
  arr.push(url)
  ctx.card['schema:url'] = arr
  renderLinks(arr)
  scheduleSave()
}

function removeLink(url) {
  const list = ctx.card['schema:url']
  const arr = Array.isArray(list) ? list : (list ? [list] : [])
  ctx.card['schema:url'] = arr.filter(u => u !== url)
  renderLinks(ctx.card['schema:url'])
  scheduleSave()
}

function triggerAvatarUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    await uploadAvatar(file)
  }
  input.click()
}

async function uploadAvatar(file) {
  try {
    const r = await fetch(AVATAR_URL, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/png' },
      credentials: 'include',
      body: file,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    ctx.card['foaf:img'] = '/profile/avatar.png'
    document.getElementById('avatar').src = AVATAR_URL + '?t=' + Date.now()
    toast('avatar updated')
    scheduleSave()
  } catch (e) {
    toast('avatar upload failed: ' + e.message, true)
  }
}

let saveTimer = null
function scheduleSave() {
  ctx.dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 700)
}

async function save() {
  if (!ctx.dirty) return
  ctx.dirty = false
  try {
    const r = await fetch(CARD_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/ld+json' },
      credentials: 'include',
      body: JSON.stringify(ctx.card, null, 2),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const md = renderSoulMd(ctx.card)
    await fetch(SOUL_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown' },
      credentials: 'include',
      body: md,
    }).catch(() => {})
    document.getElementById('soulPreview').textContent = md
    toast('saved')
  } catch (e) {
    toast('save failed: ' + e.message, true)
    ctx.dirty = true
  }
}

// ---------- Render: agent view (SOUL.md) ----------

function renderAgentView() {
  const md = renderSoulMd(ctx.card)
  document.getElementById('soulPreview').textContent = md
  document.getElementById('soulUrl').textContent = new URL(SOUL_URL).pathname
}

function renderSoulMd(card) {
  const name = card['foaf:name'] || card.name || 'Anonymous'
  const handle = card['schema:alternateName'] || card.alternateName
  const status = card['schema:description'] || card.description
  const values = toArray(card['soul:values'])
  const comms = card['soul:commsStyle']
  const limits = toArray(card['soul:hardLimits'])
  const memory = card['soul:memoryPolicy']
  const urls = toArray(card['schema:url'] || card.url)

  const lines = []
  lines.push(`# SOUL.md — ${name}`)
  lines.push('')
  lines.push('## Identity')
  lines.push(`${name}${handle ? ` (${handle})` : ''}.${status ? ' ' + status : ''}`)
  lines.push('')

  if (values.length) {
    lines.push('## Values')
    for (const v of values) lines.push(`- ${v}`)
    lines.push('')
  }

  if (comms) {
    lines.push('## Communication Style')
    if (typeof comms === 'string') lines.push(comms)
    else for (const [k, v] of Object.entries(comms)) lines.push(`- ${k}: ${v}`)
    lines.push('')
  }

  if (limits.length) {
    lines.push('## Hard Limits')
    for (const l of limits) lines.push(`- ${l}`)
    lines.push('')
  }

  if (memory) {
    lines.push('## Memory Policy')
    lines.push(memory)
    lines.push('')
  }

  if (urls.length) {
    lines.push('## Find me at')
    for (const u of urls) lines.push(`- ${u}`)
    lines.push('')
  }

  lines.push(`*Generated from <${CARD_URL}>. Edit via the profile app, not this file.*`)
  return lines.join('\n')
}

function toArray(x) {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

// ---------- Apps installed on this pod ----------

async function loadInstalledApps() {
  try {
    const r = await fetch(APPS_CONTAINER, {
      headers: { Accept: 'application/ld+json' },
      credentials: 'include',
    })
    if (!r.ok) return
    const j = await r.json()
    const contains = j['@graph']?.[0]?.['ldp:contains'] || j['ldp:contains'] || []
    const arr = Array.isArray(contains) ? contains : [contains]
    const list = document.getElementById('appList')
    list.innerHTML = ''
    for (const item of arr) {
      const url = typeof item === 'string' ? item : item['@id']
      if (!url) continue
      const name = url.replace(/\/$/, '').split('/').pop()
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = url
      a.textContent = name
      li.appendChild(a)
      list.appendChild(li)
    }
  } catch {}
}

// ---------- View toggle ----------

document.getElementById('viewToggle').addEventListener('click', () => {
  const body = document.body
  body.dataset.view = body.dataset.view === 'human' ? 'agent' : 'human'
})

document.getElementById('copyLink').addEventListener('click', (e) => {
  e.preventDefault()
  navigator.clipboard.writeText(`${POD}/profile/`).then(() => toast('link copied'))
})

// ---------- Wizard ----------

function openWizard() {
  const wiz = document.getElementById('wizard')
  wiz.showModal()
  document.getElementById('wizardForm').addEventListener('submit', onWizardSubmit, { once: true })
}

async function onWizardSubmit(e) {
  e.preventDefault()
  const form = new FormData(e.currentTarget)
  const name = (form.get('name') || '').toString().trim()
  const status = (form.get('status') || '').toString().trim()
  const photo = form.get('photo')

  const card = {
    '@context': {
      schema: 'https://schema.org/',
      foaf: 'http://xmlns.com/foaf/0.1/',
      soul: 'urn:soul:',
    },
    '@id': '#me',
    '@type': ['schema:Person', 'foaf:Person'],
    'foaf:name': name,
    'schema:description': status || undefined,
  }

  if (photo && photo.size > 0) {
    try {
      await fetch(AVATAR_URL, {
        method: 'PUT',
        headers: { 'Content-Type': photo.type || 'image/png' },
        credentials: 'include',
        body: photo,
      })
      card['foaf:img'] = '/profile/avatar.png'
    } catch {}
  }

  ctx.card = card
  document.getElementById('wizard').close()
  await save()
  document.getElementById('app').classList.remove('loading')
  render()
  renderAgentView()
  loadInstalledApps()
}

// ---------- Toast ----------

function toast(msg, isError = false) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.toggle('error', isError)
  t.classList.add('show')
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => t.classList.remove('show'), 1800)
}

// ---------- Go ----------

boot().catch((e) => {
  console.error(e)
  toast('profile failed to load: ' + e.message, true)
})
