import zlib from 'node:zlib';

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
