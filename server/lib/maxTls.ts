import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

/**
 * platform-api2.max.ru is signed by the Russian Trusted CA (Минцифры).
 * Node's Mozilla bundle does not include it, so fetch() fails before we can
 * save a bot token. Official PEMs: https://www.gosuslugi.ru/crt
 */
const CERT_FILES = ["russian_trusted_root_ca.pem", "russian_trusted_sub_ca.pem"] as const;

let installed = false;

function certDirs(): string[] {
  const dirs: string[] = [];
  try {
    dirs.push(join(dirname(fileURLToPath(import.meta.url)), "..", "certs"));
  } catch {
    // import.meta.url is unavailable in some bundled runtimes
  }
  dirs.push(join(process.cwd(), "server", "certs"));
  return [...new Set(dirs)];
}

function readBundledCerts(): string[] {
  const pems: string[] = [];
  const seen = new Set<string>();
  for (const dir of certDirs()) {
    for (const file of CERT_FILES) {
      const path = join(dir, file);
      if (!existsSync(path)) {
        continue;
      }
      try {
        const pem = readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim();
        const key = pem.replace(/\s/g, "");
        if (pem.includes("BEGIN CERTIFICATE") && !seen.has(key)) {
          seen.add(key);
          pems.push(pem);
        }
      } catch {
        // Skip unreadable files and keep looking in other directories.
      }
    }
  }
  return pems;
}

function currentCaList(): string[] {
  try {
    if (typeof tls.getCACertificates === "function") {
      const current = tls.getCACertificates();
      if (Array.isArray(current) && current.length > 0) {
        return current;
      }
    }
  } catch {
    // Older Node builds may not expose getCACertificates.
  }
  return [...tls.rootCertificates];
}

export function ensureMaxTrustedCa(): boolean {
  if (installed) {
    return true;
  }
  const extra = readBundledCerts();
  if (extra.length === 0) {
    console.warn("MAX TLS: bundled MinTsifry CA certificates are missing");
    return false;
  }
  try {
    if (typeof tls.setDefaultCACertificates === "function") {
      const current = currentCaList();
      const compact = (value: string) => value.replace(/\s/g, "");
      const missing = extra.filter(
        (pem) => !current.some((item) => compact(item) === compact(pem)),
      );
      if (missing.length > 0) {
        tls.setDefaultCACertificates([...current, ...missing]);
      }
      installed = true;
      return true;
    }
    const original = tls.createSecureContext;
    tls.createSecureContext = ((options: tls.SecureContextOptions = {}) => {
      const existing = options.ca
        ? Array.isArray(options.ca)
          ? options.ca
          : [options.ca]
        : [...tls.rootCertificates];
      return original.call(tls, { ...options, ca: [...existing, ...extra] });
    }) as typeof tls.createSecureContext;
    installed = true;
    return true;
  } catch (err) {
    console.warn("MAX TLS: failed to trust MinTsifry CA", err);
    return false;
  }
}
