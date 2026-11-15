/**
 * Chiffrement des jetons Meta — AES-256-GCM.
 * Clé : TOKEN_ENCRYPTION_KEY (64 caractères hex = 32 octets) dans .env, serveur uniquement.
 * Sans clé configurée : mode démo (jetons simulés, jamais de vrais jetons stockés en clair).
 */
'use strict';
const crypto = require('crypto');

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  return null;
}
function isEncryptionReady() { return Boolean(getKey()); }

function encrypt(text) {
  const key = getKey();
  if (!key) return 'demo:' + Buffer.from(String(text), 'utf8').toString('base64'); // mode démo uniquement
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

function decrypt(payload) {
  if (!payload) return '';
  if (payload.startsWith('demo:')) return Buffer.from(payload.slice(5), 'base64').toString('utf8');
  const key = getKey();
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY manquante : impossible de déchiffrer.');
  const [, ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncryptionReady };
