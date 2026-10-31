import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presign } from '../scripts/stem-library/sigv4.mjs';

// Vector oficial de AWS: "Authenticating Requests: Using Query Parameters"
// (GET examplebucket/test.txt, 24/05/2013, expira en 86400 s).
test('presign reproduce la firma del ejemplo oficial de AWS', () => {
  const url = presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expires: 86400,
    date: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.ok(url.startsWith('https://examplebucket.s3.amazonaws.com/test.txt?'));
});

test('presign codifica espacios y acentos de la ruta', () => {
  const url = presign({
    method: 'PUT', host: 'h', path: '/b/catalog/pack/Batería básica.wav',
    accessKeyId: 'k', secretAccessKey: 's', date: new Date('2026-01-01T00:00:00Z'),
  });
  assert.ok(url.startsWith('https://h/b/catalog/pack/Bater%C3%ADa%20b%C3%A1sica.wav?'));
});
