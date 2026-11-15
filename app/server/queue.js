/**
 * File d'attente des messages entrants.
 * v1 : file en mémoire avec concurrence limitée + réessais (délai croissant).
 * Production (Étape 6) : remplacer par BullMQ + Redis — même interface push/process.
 * Objectif : répondre 200 immédiatement à Meta, traiter ensuite (< 10 s par message).
 */
'use strict';

class Queue {
  constructor(handler, { concurrency = 5, maxRetries = 3 } = {}) {
    this.handler = handler;
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;
    this.jobs = [];
    this.active = 0;
    this.stats = { processed: 0, failed: 0, retried: 0 };
    this.seen = new Set(); // anti-doublon webhook (externalId)
  }

  push(job) {
    if (job.externalId) {
      if (this.seen.has(job.externalId)) return { queued: false, duplicate: true };
      this.seen.add(job.externalId);
      if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    }
    this.jobs.push({ ...job, attempts: 0 });
    this._drain();
    return { queued: true };
  }

  async _drain() {
    while (this.active < this.concurrency && this.jobs.length) {
      const job = this.jobs.shift();
      this.active++;
      this._run(job).finally(() => { this.active--; this._drain(); });
    }
  }

  async _run(job) {
    try {
      await this.handler(job);
      this.stats.processed++;
    } catch (e) {
      job.attempts++;
      if (job.attempts <= this.maxRetries) {
        this.stats.retried++;
        const delay = Math.min(1000 * 2 ** job.attempts, 15000);
        console.warn(`[queue] réessai ${job.attempts}/${this.maxRetries} dans ${delay}ms —`, e.message);
        setTimeout(() => { this.jobs.push(job); this._drain(); }, delay);
      } else {
        this.stats.failed++;
        console.error('[queue] ÉCHEC définitif (alerte à créer):', job.channel, job.externalId, e.message);
      }
    }
  }
}

module.exports = Queue;
