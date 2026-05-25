import os from "node:os";

export interface PairingHost {
  host: string;
  network: "local" | "tailscale";
  label: string;
}

export function makePairingURI(host: string, port: number, service?: string, label?: string): string | undefined {
  const trimmedHost = host.trim();
  if (!trimmedHost) return undefined;
  const params = new URLSearchParams();
  params.set("host", trimmedHost);
  params.set("port", String(port));
  if (service?.trim()) params.set("service", service.trim());
  if (label?.trim()) params.set("label", label.trim());
  return `samuxy://pair?${params.toString()}`;
}

export function isTailscaleAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

export function availablePairingHosts(): PairingHost[] {
  const hosts: PairingHost[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      hosts.push({
        host: address.address,
        network: isTailscaleAddress(address.address) ? "tailscale" : "local",
        label: address.address
      });
    }
  }
  return hosts;
}
