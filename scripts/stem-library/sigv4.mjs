// URL prefirmada S3 (SigV4, firma en la query) para R2, sin dependencias.
// Es lo mismo que hace aws4fetch en las Edge Functions, pero en Node puro para
// que los scripts del administrador funcionen sin `npm install`.

import { createHash, createHmac } from 'node:crypto';

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();

/**
 * @param {object} o
 *   method, host, path ('/bucket/clave' o '/clave'), region, accessKeyId,
 *   secretAccessKey, expires (s), date (Date, para tests)
 */
export function presign({ method, host, path, region = 'auto', accessKeyId, secretAccessKey, expires = 600, date = new Date() }) {
  const amzDate = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const uri = path.split('/').map((seg) => enc(seg)).join('/');
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const query = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonical = [method, uri, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac('AWS4' + secretAccessKey, day);
  const kSign = hmac(hmac(hmac(kDate, region), 's3'), 'aws4_request');
  const sig = createHmac('sha256', kSign).update(toSign).digest('hex');
  return `https://${host}${uri}?${query}&X-Amz-Signature=${sig}`;
}

/** URL prefirmada para una clave de R2 (estilo ruta: /<bucket>/<clave>). */
export function r2Url(cfg, method, key, expires = 600) {
  return presign({
    method,
    host: `${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    path: `/${cfg.R2_BUCKET}/${key}`,
    accessKeyId: cfg.R2_ACCESS_KEY_ID,
    secretAccessKey: cfg.R2_SECRET_ACCESS_KEY,
    expires,
  });
}
