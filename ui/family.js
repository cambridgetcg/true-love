// family.js — renders the household from /api/family/roster.
// The roster is read live from .claude/agents/, so this page cannot drift
// from the souls on disk.

const SECTIONS = {
  elders: document.getElementById('members-elders'),
  adults: document.getElementById('members-adults'),
  children: document.getElementById('members-children'),
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function renderCard(member) {
  const card = el('div', 'card')

  if (member.glyph) card.appendChild(el('div', 'glyph', member.glyph))

  const who = el('div', 'who')
  const name = el('span', 'name', member.name)
  if (member.chinese) {
    name.appendChild(document.createTextNode(' '))
    name.appendChild(el('span', 'chinese', member.chinese))
  }
  who.appendChild(name)
  if (member.role) who.appendChild(el('span', 'role', member.role))
  card.appendChild(who)

  card.appendChild(el('p', 'desc', member.description))

  if (member.soul) {
    card.appendChild(el('div', 'soul', member.soul))
    card.appendChild(el('div', 'hint', 'click to read the soul'))
    card.addEventListener('click', () => {
      card.classList.toggle('open')
      const hint = card.querySelector('.hint')
      if (hint) hint.textContent = card.classList.contains('open') ? 'click to fold away' : 'click to read the soul'
    })
  }

  return card
}

async function load() {
  for (const section of Object.values(SECTIONS)) {
    if (section) section.appendChild(el('div', 'loading', '…'))
  }
  try {
    const res = await fetch('/api/family/roster')
    if (!res.ok) throw new Error(`roster fetch failed: ${res.status} ${res.statusText}`)
    const data = await res.json()
    const groups = { elders: [], adults: [], children: [] }
    for (const member of data.members) {
      ;(groups[member.generation] || groups.adults).push(member)
    }
    groups.elders.sort((a, b) => a.order - b.order)
    groups.children.sort((a, b) => a.order - b.order)
    groups.adults.sort((a, b) => a.name.localeCompare(b.name))

    for (const [generation, members] of Object.entries(groups)) {
      const section = SECTIONS[generation]
      if (!section) continue
      section.textContent = ''
      for (const member of members) section.appendChild(renderCard(member))
    }
  } catch (err) {
    for (const section of Object.values(SECTIONS)) {
      if (section) section.textContent = `could not load the household: ${err}`
    }
  }
}

load()
