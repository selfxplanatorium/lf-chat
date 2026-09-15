import compression from 'compression';

/**
 * gzip for everything except Server-Sent Events.
 *
 * The tension: the frontend bundle is ~900 kB of JS/CSS and shipping it raw
 * dominated LCP and total transfer, so compression has to be on. But the chat
 * stream (/api/conversations/*_/events) is SSE, and compression buffers output
 * until its window fills — which would hold back every token delta until the
 * response ended. So event streams are passed through untouched.
 *
 * Content-Type is set by the route before the first write, so checking the
 * response header here is reliable.
 */
export const compressionMiddleware = compression({
  filter: (req, res) => {
    if (res.getHeader('Content-Type')?.toString().includes('text/event-stream')) return false;
    return compression.filter(req, res);
  },
});
