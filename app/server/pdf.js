/**
 * Extraction de texte d'un PDF — zéro dépendance (Node >= 18).
 * Lit les flux de contenu du PDF (compressés FlateDecode via zlib intégré,
 * ou en clair) et en extrait le texte affiché (opérateurs Tj / TJ).
 * Suffisant pour les catalogues, listes de prix et documents texte.
 * Limite honnête : un PDF "scanné" (image) ne contient aucun texte ->
 * extractPdfText renvoie '' et l'API demandera à l'utilisateur de
 * copier-coller le texte à la place.
 */
'use strict';

const zlib = require('zlib');

function decodePdfString(s) {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

function textFromContent(buf) {
  const src = buf.toString('latin1');
  const out = [];
  // Chaînes (...) Tj et tableaux [...] TJ
  const re = /\((?:\\.|[^\\()])*\)\s*(?:Tj|')|\[(?:\\.|[^\]\\])*\]\s*TJ/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const bloc = m[0];
    const strings = bloc.match(/\((?:\\.|[^\\()])*\)/g) || [];
    out.push(strings.map(s => decodePdfString(s.slice(1, -1))).join(''));
    out.push('\n');
  }
  // Sauts de ligne explicites
  return out.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Extrait tout le texte lisible d'un Buffer PDF. Renvoie '' si aucun texte. */
function extractPdfText(buffer) {
  if (!buffer || buffer.length < 5 || buffer.slice(0, 4).toString('latin1') !== '%PDF') {
    const e = new Error('not_a_pdf'); e.code = 'NOT_A_PDF'; throw e;
  }
  const raw = buffer.toString('latin1');
  const parts = [];
  // 1) flux "stream ... endstream"
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    const data = buffer.slice(start, end);
    let content = null;
    try { content = zlib.inflateSync(data); } catch (e) {
      try { content = zlib.inflateSync(data.slice(0, data.length - 1)); } catch (e2) { content = data; }
    }
    if (content) {
      const t = textFromContent(content);
      if (t) parts.push(t);
    }
    streamRe.lastIndex = end + 9;
  }
  // 2) texte en clair hors flux (PDF non compressés)
  if (!parts.length) {
    const t = textFromContent(buffer);
    if (t) parts.push(t);
  }
  return parts.join('\n').replace(/\s+\n/g, '\n').trim().slice(0, 60000);
}

module.exports = { extractPdfText };
