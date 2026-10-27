// Formatierte Notizen: Bereinigen (nur erlaubte Formate), Anzeige, Tabellen.
// Gespeichert wird HTML – aber nur das, was hier ausdrücklich erlaubt ist.

// Erlaubte Elemente (manche werden umbenannt, z. B. <b> → <strong>)
const RENAME = { B: 'STRONG', I: 'EM', DIV: 'P' };
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'A']);
// Diese werden samt Inhalt entfernt
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'IMG', 'VIDEO', 'AUDIO', 'PICTURE', 'SOURCE', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'CANVAS', 'HEAD', 'TITLE']);
const SAFE_LINK = /^(https?:|mailto:|tel:)/i;

// Inertes Dokument: hier wird nichts ausgeführt und nichts nachgeladen
const inert = () => document.implementation.createHTMLDocument('');

function cleanInto(src, dest, doc) {
  for (const node of [...src.childNodes]) {
    if (node.nodeType === 3) {
      dest.appendChild(doc.createTextNode(node.nodeValue));
      continue;
    }
    if (node.nodeType !== 1) continue; // Kommentare u. Ä. weg
    const tag = node.tagName.toUpperCase();
    if (DROP.has(tag)) continue;
    const name = RENAME[tag] || tag;
    if (!ALLOWED.has(name)) {
      cleanInto(node, dest, doc); // unbekannt: nur den Inhalt behalten
      continue;
    }
    const el = doc.createElement(name);
    if (name === 'A') {
      const href = (node.getAttribute('href') || '').trim();
      if (!SAFE_LINK.test(href)) {
        cleanInto(node, dest, doc);
        continue;
      }
      el.setAttribute('href', href);
    }
    if (name === 'UL' && node.classList?.contains('checklist')) el.setAttribute('class', 'checklist');
    if (name === 'LI' && node.getAttribute('data-done') === '1') el.setAttribute('data-done', '1');
    cleanInto(node, el, doc);
    dest.appendChild(el);
  }
}

// Beliebiges HTML → nur erlaubte Formate
export function sanitize(html) {
  const doc = inert();
  const src = doc.createElement('div');
  src.innerHTML = String(html || '');
  const out = doc.createElement('div');
  cleanInto(src, out, doc);
  return out.innerHTML;
}

// Alte Notizen sind reiner Text: als Absätze übernehmen
export const isHtml = (body) => /^\s*<(p|h2|h3|ul|ol|div|blockquote|table|hr|br|strong|em)[\s>/]/i.test(body || '');
export function plainToHtml(text) {
  const doc = inert();
  const out = doc.createElement('div');
  for (const line of String(text || '').split('\n')) {
    const p = doc.createElement('p');
    if (line) p.textContent = line;
    else p.appendChild(doc.createElement('br'));
    out.appendChild(p);
  }
  return out.innerHTML;
}
export const bodyToHtml = (body) => (isHtml(body) ? sanitize(body) : plainToHtml(body));

// Reiner Text (für Vorschau und Suche)
export function toText(body) {
  if (!isHtml(body)) return String(body || '');
  const doc = inert();
  const div = doc.createElement('div');
  div.innerHTML = sanitize(body).replace(/<\/(p|h2|h3|li|tr|blockquote)>/gi, '$& ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/t[dh]>/gi, '$& ');
  return div.textContent.replace(/\s+/g, ' ').trim();
}

// Anzeige: bereinigen und Telefonnummern, E-Mails, Links antippbar machen
const LINKS = /(https?:\/\/[^\s<]+)|([\w.+-]+@[\w-]+\.[\w.-]+)|((?:\+|\b0)\d[\d /-]{5,}\d)/g;
export function renderHtml(body) {
  const doc = inert();
  const root = doc.createElement('div');
  root.innerHTML = bodyToHtml(body);
  const walker = doc.createTreeWalker(root, 4);
  const texts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('a')) texts.push(walker.currentNode);
  for (const t of texts) {
    const s = t.nodeValue;
    LINKS.lastIndex = 0;
    if (!LINKS.test(s)) continue;
    LINKS.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of s.matchAll(LINKS)) {
      frag.appendChild(doc.createTextNode(s.slice(last, m.index)));
      const a = doc.createElement('a');
      a.textContent = m[0];
      a.setAttribute('href', m[1] ? m[1] : m[2] ? `mailto:${m[2]}` : `tel:${m[3].replace(/[^\d+]/g, '')}`);
      if (m[1]) a.setAttribute('target', '_blank');
      frag.appendChild(a);
      last = m.index + m[0].length;
    }
    frag.appendChild(doc.createTextNode(s.slice(last)));
    t.replaceWith(frag);
  }
  // Links aus der Notiz in neuem Fenster öffnen (Webseiten)
  root.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
  return root.innerHTML;
}

// Checkliste in der Anzeige: n-ten Punkt ab-/anhaken
export function toggleCheck(body, index) {
  const doc = inert();
  const root = doc.createElement('div');
  root.innerHTML = bodyToHtml(body);
  const li = root.querySelectorAll('ul.checklist > li')[index];
  if (!li) return null;
  if (li.getAttribute('data-done') === '1') li.removeAttribute('data-done');
  else li.setAttribute('data-done', '1');
  return sanitize(root.innerHTML);
}

/* ---------- Tabellen im Editor ---------- */

export const TABLE_HTML =
  '<table data-new="1"><thead><tr><th><br></th><th><br></th></tr></thead><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>';

// Zelle, in der der Cursor steht
export function currentCell(editor) {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node || !editor.contains(node)) return null;
  return (node.nodeType === 1 ? node : node.parentElement).closest('td, th');
}

export function tableOp(editor, op) {
  const cell = currentCell(editor);
  if (!cell) return false;
  const row = cell.parentElement;
  const table = cell.closest('table');
  const col = [...row.children].indexOf(cell);
  const rows = [...table.querySelectorAll('tr')];
  const blank = (tag) => {
    const c = document.createElement(tag);
    c.appendChild(document.createElement('br'));
    return c;
  };
  if (op === 'row-add') {
    const tr = document.createElement('tr');
    for (let i = 0; i < row.children.length; i++) tr.appendChild(blank('td'));
    // Unter einer Kopfzeile: neue Zeile oben in den Tabellenrumpf
    if (row.parentElement.tagName === 'THEAD') {
      const body = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
      body.insertBefore(tr, body.firstChild);
    } else row.after(tr);
    placeCaret(tr.children[Math.min(col, tr.children.length - 1)]);
  } else if (op === 'col-add') {
    for (const tr of rows) {
      const ref = tr.children[col];
      const c = blank(tr.parentElement.tagName === 'THEAD' ? 'th' : 'td');
      if (ref) ref.after(c);
      else tr.appendChild(c);
    }
    placeCaret(row.children[col + 1]);
  } else if (op === 'row-del') {
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    if (!table.querySelector('tr')) return removeTable(table);
    if (!table.querySelector('tbody tr') && !table.querySelector('thead tr')) return removeTable(table);
    placeCaret(next?.children[Math.min(col, next.children.length - 1)] || table.querySelector('td, th'));
  } else if (op === 'col-del') {
    for (const tr of rows) tr.children[col]?.remove();
    if (!table.querySelector('td, th')) return removeTable(table);
    placeCaret(row.children[Math.max(0, col - 1)] || table.querySelector('td, th'));
  } else if (op === 'table-del') {
    return removeTable(table);
  }
  return true;
}

function removeTable(table) {
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  table.replaceWith(p);
  placeCaret(p);
  return true;
}

// Nach dem Einfügen: Cursor in die erste Zelle der neuen Tabelle
export function focusNewTable(editor) {
  const t = editor.querySelector('table[data-new]');
  if (!t) return;
  t.removeAttribute('data-new');
  placeCaret(t.querySelector('th, td'));
}

// Tab in einer Zelle: zur nächsten Zelle (am Ende neue Zeile)
export function nextCell(editor, back = false) {
  const cell = currentCell(editor);
  if (!cell) return false;
  const cells = [...cell.closest('table').querySelectorAll('th, td')];
  const i = cells.indexOf(cell) + (back ? -1 : 1);
  if (i >= 0 && i < cells.length) placeCaret(cells[i]);
  else if (!back) {
    placeCaret(cells[cells.length - 1]);
    tableOp(editor, 'row-add');
    const rows = cell.closest('table').querySelectorAll('tr');
    placeCaret(rows[rows.length - 1].firstElementChild);
  }
  return true;
}

export function placeCaret(el) {
  if (!el) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ---------- Checklisten in Notizen ---------- */

// Alte Listen-Notizen → formatierte Notiz (Zwischenüberschriften + Checkliste, Häkchen bleiben)
export function listItemsToHtml(items) {
  const doc = inert();
  const root = doc.createElement('div');
  let ul = null;
  for (const x of items || []) {
    if (x.head) {
      const h = doc.createElement('h3');
      h.textContent = x.text;
      root.appendChild(h);
      ul = null;
      continue;
    }
    if (!ul) {
      ul = doc.createElement('ul');
      ul.setAttribute('class', 'checklist');
      root.appendChild(ul);
    }
    const li = doc.createElement('li');
    li.textContent = x.text;
    if (x.done) li.setAttribute('data-done', '1');
    ul.appendChild(li);
  }
  return root.innerHTML;
}

function checkItems(body) {
  if (!isHtml(body)) return { root: null, items: [] };
  const doc = inert();
  const root = doc.createElement('div');
  root.innerHTML = sanitize(body);
  return { root, items: [...root.querySelectorAll('ul.checklist > li')] };
}
// Fortschritt: wie viele Punkte abgehakt
export function checkStats(body) {
  const { items } = checkItems(body);
  return { done: items.filter((li) => li.getAttribute('data-done') === '1').length, total: items.length };
}
// Alle Haken entfernen (Packliste fürs nächste Mal)
export function resetChecks(body) {
  const { root, items } = checkItems(body);
  if (!root) return body;
  items.forEach((li) => li.removeAttribute('data-done'));
  return sanitize(root.innerHTML);
}
// Offene Punkte als Text (z. B. für die Einkaufsliste)
export const openChecks = (body) =>
  checkItems(body).items.filter((li) => li.getAttribute('data-done') !== '1').map((li) => li.textContent.trim()).filter(Boolean);

/* ---------- Cursor an die angetippte Stelle ---------- */

// Ansicht und Editor haben dieselben Absätze (nur Links unterscheiden sich),
// daher merken wir uns: welcher Absatz, wie viele Zeichen hinein.
const BLOCKS = 'p, h2, h3, li, td, th, blockquote';

function pointToCaret(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

function textBefore(block, node, offset) {
  const walker = document.createTreeWalker(block, 4);
  let n = 0;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (t === node) return n + offset;
    // Cursor sitzt zwischen Elementen: alles Text davor zählen
    if (node.nodeType === 1 && node.childNodes[offset] && (node.childNodes[offset] === t || node.childNodes[offset].contains(t))) return n;
    n += t.nodeValue.length;
  }
  return n;
}

export function caretSpot(root, x, y) {
  const c = pointToCaret(x, y);
  if (!c || !root.contains(c.node)) return null;
  const el = c.node.nodeType === 1 ? c.node : c.node.parentElement;
  const block = el.closest(BLOCKS);
  if (!block || !root.contains(block)) return null;
  return { index: [...root.querySelectorAll(BLOCKS)].indexOf(block), chars: textBefore(block, c.node, c.offset) };
}

export function placeAtSpot(root, spot) {
  const block = spot && root.querySelectorAll(BLOCKS)[spot.index];
  if (!block) return false;
  const walker = document.createTreeWalker(block, 4);
  let left = spot.chars;
  let last = null;
  while (walker.nextNode()) {
    const t = walker.currentNode;
    last = t;
    if (left <= t.nodeValue.length) {
      const r = document.createRange();
      r.setStart(t, left);
      r.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }
    left -= t.nodeValue.length;
  }
  if (last) {
    const r = document.createRange();
    r.setStart(last, last.nodeValue.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } else placeCaret(block); // leerer Absatz
  return true;
}

// Offene Punkte mit ihrer Zwischenüberschrift (für die Auswahl „Auf die Einkaufsliste“)
export function openChecksGrouped(body) {
  const { root } = checkItems(body);
  if (!root) return [];
  const out = [];
  let head = '';
  for (const el of root.querySelectorAll('h2, h3, ul.checklist > li')) {
    if (el.tagName !== 'LI') head = el.textContent.trim();
    else if (el.getAttribute('data-done') !== '1' && el.textContent.trim()) out.push({ head, text: el.textContent.trim() });
  }
  return out;
}
