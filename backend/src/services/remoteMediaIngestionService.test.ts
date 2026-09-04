import assert from "node:assert/strict";
import test from "node:test";
import {
  detectImageMimeFromBytes,
  extractHtmlImageUrl,
  isBlockedHostname,
  isBlockedIpAddress,
  isSupportedImageMime,
  MediaIngestionError,
  normalizeContentType,
  parseIngestableUrl,
  sha256Hex
} from "./remoteMediaIngestionService";

test("aceita somente http e https", () => {
  assert.equal(parseIngestableUrl("https://cdn.discordapp.com/a.png?ex=1&is=2").protocol, "https:");
  assert.equal(parseIngestableUrl("http://site.com/imagem").protocol, "http:");

  for (const url of ["file:///etc/passwd", "ftp://site.com/a.png", "data:image/png;base64,AAAA", "javascript:alert(1)"]) {
    assert.throws(() => parseIngestableUrl(url), MediaIngestionError, `${url} deveria ser recusado`);
  }
  assert.throws(() => parseIngestableUrl("nao-e-url"), MediaIngestionError);
});

test("bloqueia loopback e redes privadas (SSRF)", () => {
  for (const address of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "::1", "fe80::1", "fd00::1"]) {
    assert.equal(isBlockedIpAddress(address), true, `${address} deveria ser bloqueado`);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"]) {
    assert.equal(isBlockedIpAddress(address), false, `${address} nao deveria ser bloqueado`);
  }
});

test("bloqueia hostnames internos e ipv4 mapeado em ipv6", () => {
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("api.localhost"), true);
  assert.equal(isBlockedHostname("servico.internal"), true);
  assert.equal(isBlockedHostname("[::ffff:127.0.0.1]"), true);
  assert.equal(isBlockedHostname("cdn.discordapp.com"), false);
});

test("detecta o tipo pelos magic bytes, nao pela extensao", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12)]);
  const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(12)]);
  const webp = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii"), Buffer.alloc(4)]);

  assert.equal(detectImageMimeFromBytes(png), "image/png");
  assert.equal(detectImageMimeFromBytes(jpeg), "image/jpeg");
  assert.equal(detectImageMimeFromBytes(gif), "image/gif");
  assert.equal(detectImageMimeFromBytes(webp), "image/webp");
  assert.equal(detectImageMimeFromBytes(Buffer.from("<!doctype html><html></html>")), null);
  assert.equal(detectImageMimeFromBytes(Buffer.alloc(4)), null);
});

test("content-type e normalizado sem parametros", () => {
  assert.equal(normalizeContentType("image/png; charset=binary"), "image/png");
  assert.equal(normalizeContentType("IMAGE/JPEG"), "image/jpeg");
  assert.equal(normalizeContentType(null), null);
});

test("apenas png, jpeg, webp e gif sao aceitos", () => {
  assert.equal(isSupportedImageMime("image/png"), true);
  assert.equal(isSupportedImageMime("image/webp"), true);
  assert.equal(isSupportedImageMime("image/svg+xml"), false);
  assert.equal(isSupportedImageMime("text/html"), false);
  assert.equal(isSupportedImageMime(null), false);
});

test("extrai imagem de HTML por og:image e twitter:image", () => {
  const og = '<html><head><meta property="og:image" content="/media/foto.png"></head></html>';
  assert.equal(extractHtmlImageUrl(og, "https://site.com/post/1"), "https://site.com/media/foto.png");

  const twitter = '<html><head><meta name="twitter:image" content="https://cdn.site.com/x.jpg"></head></html>';
  assert.equal(extractHtmlImageUrl(twitter, "https://site.com/post/1"), "https://cdn.site.com/x.jpg");

  assert.equal(extractHtmlImageUrl("<html><body>sem metadados</body></html>", "https://site.com"), null);
});

test("hash identifica conteudo igual vindo de URLs diferentes", () => {
  const a = Buffer.from("conteudo-identico");
  const b = Buffer.from("conteudo-identico");
  const c = Buffer.from("outro-conteudo");

  assert.equal(sha256Hex(a), sha256Hex(b));
  assert.notEqual(sha256Hex(a), sha256Hex(c));
  assert.match(sha256Hex(a), /^[0-9a-f]{64}$/);
});
