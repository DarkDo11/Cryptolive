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

export function send(req, res, statusCode, headers, body) {
  let outBody = typeof body === 'string' ? Buffer.from(body) : body;
  
  const accept = req.headers['accept-encoding'] || '';
  const contentType = headers['Content-Type'] || headers['content-type'];
  let encoding = null;

  if (outBody && outBody.length >= 1024 && isCompressible(contentType)) {
    if (accept.includes('br')) {
      encoding = 'br';
      outBody = zlib.brotliCompressSync(outBody, {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4
      });
    } else if (accept.includes('gzip')) {
      encoding = 'gzip';
      outBody = zlib.gzipSync(outBody, {
        level: 6
      });
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
