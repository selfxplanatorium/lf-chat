import './load-env';
import express from 'express';
import helmet from 'helmet';
import { compressionMiddleware } from './lib/compression';
import cors from 'cors';
import path from 'path';
import db from './db';
import authRoutes from './routes/auth';
import settingsRoutes from './routes/settings';
import conversationsRoutes from './routes/conversations';
import debugRoutes from './routes/_debug';
import { log, incrementCounter } from './generation/log';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
// Loopback by default; containers set HOST=0.0.0.0 so Docker can reach the port.
const HOST = process.env.HOST || '127.0.0.1';

app.set('trust proxy', 1);

// Served raw, the frontend bundle dominated LCP and total transfer; gzip takes
// the critical-path JS from 792 kB to 236 kB. See lib/compression for why SSE
// is exempt. (The sample nginx.conf also gzips, but Express is reachable
// directly via docker-compose, so this belongs here, not only at the proxy.)
app.use(compressionMiddleware);

app.use(helmet());
app.use(cors({ origin: process.env.APP_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));

const interruptedCount = db.prepare(`
  UPDATE conversations
  SET streaming_status = 'interrupted'
  WHERE streaming_status = 'streaming' OR streaming_status = 'queued'
`).run();

// Verification and reset codes are single-use and short-lived, but nothing ever
// deleted the spent/expired ones, so the table grew without bound. Sweeping at
// boot is enough: the rows are only ever read by exact (user, code, purpose)
// match, so stale ones cost storage, not correctness.
const prunedCodes = db.prepare('DELETE FROM verification_codes WHERE used = 1 OR expires_at < ?').run(Date.now());
if (prunedCodes.changes > 0) {
  log({ event: 'pruned_verification_codes', contentLength: prunedCodes.changes });
}

if (interruptedCount.changes > 0) {
  for (let i = 0; i < interruptedCount.changes; i++) {
    incrementCounter('interruptedOnBoot');
  }
  log({ event: 'interrupted_on_boot', contentLength: interruptedCount.changes });
}

app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/conversations', conversationsRoutes);

if (process.env.DEBUG_INTROSPECTION === '1') {
  app.use('/api/_debug', debugRoutes);
}

const staticDir = path.join(__dirname, '../../dist');
app.use(express.static(staticDir));

// express.static ignores paths with a dot-segment, so /.well-known/* would
// otherwise fall through to the SPA and answer 200 with HTML. Scoped to this
// one directory rather than flipping `dotfiles: 'allow'` on the whole of dist.
app.use('/.well-known', express.static(path.join(staticDir, '.well-known')));

// Unknown API paths are a client bug, not a page — answer in the content type
// the caller asked for instead of handing them the SPA shell.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// The frontend has no client-side routing: every view is React state and the
// app is only ever served from '/'. A catch-all returning 200 therefore told
// crawlers that every nonsense URL was a real page (a soft 404) while
// protecting no route at all. Unknown paths get a genuine 404; the body is
// still the app, so the URL stays usable for anyone who lands there.
app.get('/', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});
app.use((_req, res) => {
  res.status(404).sendFile(path.join(staticDir, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`LF CHAT server running on ${HOST}:${PORT}`);
});
