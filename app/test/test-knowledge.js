/**
 * Tests Base de connaissances — PDF + copier-coller.
 * Vérifie : extraction du texte d'un vrai PDF (flux compressé),
 * refus d'un fichier non-PDF, ajout texte collé, recherche par l'assistant.
 */
'use strict';
const assert = require('assert');
const zlib = require('zlib');
const { extractPdfText } = require('../server/pdf');
const knowledge = require('../server/knowledge');
const brain = require('../server/assistant');

(async () => {
  let n = 0; const ok = (name) => { n++; console.log(`✅ ${name}`); };
  const WS = 'test-kb-' + Date.now().toString(36);

  // Fabrique un vrai PDF minimal (texte compressé FlateDecode, comme les vrais logiciels)
  function makePdf(text) {
    const content = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n@@STREAM@@\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    objs.forEach((o, i) => { pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const withStream = pdf.replace('@@STREAM@@', stream.toString('latin1'));
    return Buffer.from(withStream, 'latin1');
  }

  // 1. Extraction d'un PDF réel compressé
  const pdf = makePdf('Le sac en cuir coute 55 dollars. Livraison Kinshasa 24h.');
  const text = extractPdfText(pdf);
  assert(text.includes('sac en cuir') && text.includes('55'), 'Texte PDF extrait: ' + text);
  ok('PDF : le texte d\'un vrai PDF compressé est extrait');

  // 2. Un fichier qui n'est pas un PDF est refusé catégoriquement
  assert.throws(() => extractPdfText(Buffer.from('Bonjour, ceci est un fichier texte')), /not_a_pdf/);
  ok('PDF : un fichier non-PDF est refusé');

  // 3. Le texte du PDF entre dans la base et l'assistant s'en sert
  knowledge.add({ workspaceId: WS, type: 'PDF', title: 'Catalogue test.pdf', content: text });
  const found = knowledge.search('Le sac en cuir coûte combien ?', { workspaceId: WS });
  assert(found.length >= 1 && found[0].content.includes('55'), 'Recherche KB sur contenu PDF');
  ok('PDF : son contenu est retrouvé quand un client pose la question');

  // 4. Copier-coller sans PDF : même résultat
  knowledge.add({ workspaceId: WS, type: 'text', title: 'Horaires collés', content: 'Nous ouvrons le dimanche de 10h à 16h, quartier Gombe.' });
  const found2 = knowledge.search('Vous ouvrez le dimanche ?', { workspaceId: WS });
  assert(found2.length >= 1 && found2[0].content.includes('dimanche'), 'Recherche KB sur texte collé');
  ok('Copier-coller : le texte sans PDF est appris exactement pareil');

  // 5. Réponse complète de l'assistant depuis le PDF appris
  const assistant = { businessName: 'Boutique Test', instructions: brain.buildInstructions({ businessName: 'Boutique Test', activity: 'Sacs', zone: 'Kinshasa', hours: '8h-20h', tone: 'chaleureux', mission: 'vendre' }) };
  const r = await brain.generateReply({ assistant, userText: 'Le sac en cuir coûte combien ?', workspaceId: WS });
  assert(r.reply.includes('55'), 'Réponse depuis le PDF: ' + r.reply);
  ok('Assistant : répond avec l\'information apprise du PDF');

  // 6. Isolation : un autre espace ne voit pas ces documents
  assert.strictEqual(knowledge.list('autre-espace-' + WS).length, 0);
  assert(knowledge.list(WS).every(k => k.caracteres > 0));
  ok('Chaque entreprise garde SES documents (espaces séparés)');

  console.log(`\n🎉 Base de connaissances (PDF + copier-coller) : ${n}/${n} tests réussis`);
})().catch(e => { console.error('❌ ÉCHEC:', e.message); process.exit(1); });
