/** Arquivos OGG mínimos, montados página a página, para testar a leitura da duração. */
export function oggPage(serial: number, granule: bigint, payload: Buffer, headerType = 0) {
  const segments: number[] = [];
  let rest = payload.length;
  while (rest >= 255) { segments.push(255); rest -= 255; }
  segments.push(rest);
  const header = Buffer.alloc(27 + segments.length);
  header.write("OggS", 0, "latin1");
  header[5] = headerType;
  header.writeBigInt64LE(granule, 6);
  header.writeUInt32LE(serial, 14);
  header[26] = segments.length;
  segments.forEach((size, i) => { header[27 + i] = size; });
  return Buffer.concat([header, payload]);
}

export function opusHead(preSkip = 312) {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "latin1");
  head[8] = 1; head[9] = 1;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(48_000, 12);
  return head;
}

/** Nota de voz do WhatsApp: OGG/Opus, posição em 48 kHz somada ao pre-skip. */
export function opusAudio(seconds: number, preSkip = 312, serial = 7) {
  return Buffer.concat([
    oggPage(serial, BigInt(0), opusHead(preSkip), 2),
    oggPage(serial, BigInt(0), Buffer.from("OpusTags", "latin1")),
    oggPage(serial, BigInt(Math.round(seconds * 48_000) + preSkip), Buffer.alloc(300, 9), 4),
  ]);
}
