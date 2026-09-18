import crypto from 'node:crypto';
import zlib from 'node:zlib';

export function weakEtag(body) {
  const length = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
  const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 16);
  return `W/"${length}-${hash}"`;
}

export function etagMatches(ifNoneMatchHeader, etag) {
  if (!ifNoneMatchHeader) return false;
  const stripWeak = (value) => value.trim().replace(/^W\//i, '');
  const target = stripWeak(etag);
  return String(ifNoneMatchHeader).split(',').some((value) => {
    const candidate = value.trim();
    return candidate === '*' || stripWeak(candidate) === target;
  });
}

function isCompressible(contentType) {
  if (!contentType) return false;
  return contentType.startsWith('text/') ||
    contentType.startsWith('application/json') ||
    contentType.startsWith('application/javascript') ||
    contentType.startsWith('image/svg+xml') ||
    contentType.startsWith('application/manifest+json');
}

function acceptedEncoding(header, encoding) {
  const accepted = new Map();
  for (const part of String(header).split(',')) {
    const [namePart, ...params] = part.trim().toLowerCase().split(';');
    if (!namePart) continue;
    let quality = 1;
    for (const param of params) {
      const match = param.trim().match(/^q\s*=\s*(\d*(?:\.\d+)?)$/);
      if (match) {
        quality = Number(match[1]);
        if (!Number.isFinite(quality) || quality < 0 || quality > 1) quality = 0;
      }
    }
    accepted.set(namePart, quality);
  }
  return accepted.has(encoding) ? accepted.get(encoding) : (accepted.get('*') || 0);
}

export function createCompressionCache({ maxEntries = 200 } = {}) {
  const entries = new Map();

  return {
    get(key, encoding) {
      return entries.get(`${key}|${encoding}`);
    },
    set(key, encoding, buffer) {
      const cacheKey = `${key}|${encoding}`;
      entries.delete(cacheKey);
      entries.set(cacheKey, buffer);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }
    },
    get size() {
      return entries.size;
    }
  };
}

export function send(req, res, statusCode, headers, body, { cacheKey, compressionCache } = {}) {
  let outBody = typeof body === 'string' ? Buffer.from(body) : body;
  
  const accept = req.headers['accept-encoding'] || '';
  const contentType = headers['Content-Type'] || headers['content-type'];
  let encoding = null;

  if (outBody && outBody.length >= 1024 && isCompressible(contentType)) {
    if (acceptedEncoding(accept, 'br') > 0) {
      encoding = 'br';
    } else if (acceptedEncoding(accept, 'gzip') > 0) {
      encoding = 'gzip';
    }

    if (encoding) {
      const cached = cacheKey !== undefined && compressionCache
        ? compressionCache.get(cacheKey, encoding) : undefined;
      if (cached !== undefined) {
        outBody = cached;
      } else {
        outBody = encoding === 'br'
          ? zlib.brotliCompressSync(outBody, {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4
          })
          : zlib.gzipSync(outBody, { level: 6 });
        if (cacheKey !== undefined && compressionCache) {
          compressionCache.set(cacheKey, encoding, outBody);
        }
      }
    }
  }

  const resHeaders = { ...headers };
  
  if (encoding) {
    resHeaders['Content-Encoding'] = encoding;
    const vary = resHeaders['Vary'] || resHeaders['vary'];
    resHeaders['Vary'] = vary ? vary + ', Accept-Encoding' : 'Accept-Encoding';
  }

  if (outBody) {
    resHeaders['Content-Length'] = outBody.length;
  }

  res.writeHead(statusCode, resHeaders);
  
  if (req.method === 'HEAD' || !outBody) {
    res.end();
  } else {
    res.end(outBody);
  }
}
