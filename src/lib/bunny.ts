// Cliente da BunnyCDN (Storage Zone dedicada do fechai). Mesmo padrão usado no
// projeto janus: PUT direto no host de storage, leitura pela pull zone.
type UploadResult = { ok: true; url: string } | { ok: false; error: string };

function readConfig() {
  const host = process.env.BUNNY_HOST;
  const storageZone = process.env.BUNNY_STORAGE_ZONE;
  const accessKey = process.env.BUNNY_ACCESS_KEY;
  const pullZone = process.env.BUNNY_PULL_ZONE;
  if (!host || !storageZone || !accessKey || !pullZone) return null;
  return { host, storageZone, accessKey, pullZone };
}

export function isBunnyConfigured(): boolean {
  return readConfig() !== null;
}

/** Sobe um arquivo para `path` dentro da storage zone e devolve a URL pública (pull zone). */
export async function uploadToBunny(
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<UploadResult> {
  const config = readConfig();
  if (!config) return { ok: false, error: "CDN não configurada" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`https://${config.host}/${config.storageZone}/${path}`, {
      method: "PUT",
      headers: { AccessKey: config.accessKey, "Content-Type": contentType },
      body: body as BodyInit,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `Falha ao enviar para a CDN (${response.status})` };
    }

    const url = `https://${config.pullZone}/${path}`;
    // Sem isso, sobrescrever um arquivo existente (ex.: widget.js ao salvar
    // personalização) não aparece pro visitante até o cache de 30 dias vencer.
    await purgeBunnyUrl(url);
    return { ok: true, url };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "Timeout ao enviar para a CDN" };
    }
    return { ok: false, error: "Erro ao enviar para a CDN" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Remove um arquivo da storage zone. Silencioso: falha de limpeza não deve travar o fluxo principal. */
export async function deleteFromBunny(path: string): Promise<void> {
  const config = readConfig();
  if (!config) return;

  try {
    await fetch(`https://${config.host}/${config.storageZone}/${path}`, {
      method: "DELETE",
      headers: { AccessKey: config.accessKey },
    });
  } catch (err) {
    console.error("[bunny] falha ao remover arquivo", path, err);
  }
}

/**
 * Purga uma URL pública do cache da Pull Zone. Necessário porque a Bunny serve
 * tudo com `Cache-Control: public, max-age=2592000` (30 dias) por padrão e
 * ignora qualquer Cache-Control mandado no upload — sem purge, reenviar um
 * arquivo (ex.: widget.js após salvar personalização) não muda o que o
 * visitante recebe até o cache vencer sozinho.
 *
 * Usa a API Key de CONTA (Bunny → ícone do perfil → Account Settings → API),
 * diferente da AccessKey da storage zone. Sem ela configurada, é um no-op —
 * silencioso de propósito, igual deleteFromBunny.
 */
export async function purgeBunnyUrl(url: string): Promise<void> {
  const apiKey = process.env.BUNNY_API_KEY;
  if (!apiKey) return;

  try {
    const response = await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(url)}`, {
      method: "POST",
      headers: { AccessKey: apiKey },
    });
    if (!response.ok) {
      console.error("[bunny] falha ao purgar cache", url, response.status);
    }
  } catch (err) {
    console.error("[bunny] falha ao purgar cache", url, err);
  }
}
