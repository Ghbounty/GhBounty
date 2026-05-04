#!/usr/bin/env bash
# GHB-74 — boot-time egress allowlist for the sandbox machine.
#
# Drops all OUTPUT by default and re-allows only:
#   - loopback
#   - established/related (return traffic for our own outbound)
#   - DNS (UDP/TCP 53) to a single chosen resolver
#   - HTTPS (443) + HTTP (80) to a curated set of hostnames whose IPs
#     we resolve at boot and pin in /etc/hosts
#
# Run as root from entrypoint.sh BEFORE handing off to runner.mjs.
# Fails the boot if iptables can't be loaded — better to refuse
# service than to silently allow full egress and have ops believe
# the firewall is on.
#
# Hostname allowlist is intentionally small — it covers the registries
# the supported runners (npm/pnpm/yarn, pip, cargo, go, forge, anchor)
# need to install deps. Anything not listed here silently fails to
# connect inside the sandbox; that's the point. When adding a new
# runner that needs a new origin, ADD IT HERE and bump the image tag.

set -euo pipefail

DNS=1.1.1.1
RESOLV=/etc/resolv.conf
HOSTS=/etc/hosts

WHITELIST=(
  # GitHub (PR fetch, foundry forge install, cargo git deps, golang
  # modules with no proxy redirect, crates with git sources).
  github.com
  api.github.com
  codeload.github.com
  objects.githubusercontent.com
  raw.githubusercontent.com
  # npm / yarn registry (pnpm proxies through registry.npmjs.org too).
  registry.npmjs.org
  registry.yarnpkg.com
  # PyPI + its file CDN (pip needs both — index lives on pypi.org,
  # actual wheels on files.pythonhosted.org).
  pypi.org
  files.pythonhosted.org
  pythonhosted.org
  # Cargo: classic + sparse registries.
  crates.io
  static.crates.io
  index.crates.io
  # Go module proxy (the default for `go mod download` since Go 1.13).
  proxy.golang.org
  sum.golang.org
)

# 1. Force DNS to our chosen resolver. Fly's default is an internal
#    IPv6 (fdaa::3) that we'd otherwise have to allowlist; pinning to
#    1.1.1.1 keeps the rule set small and predictable.
echo "nameserver $DNS" > "$RESOLV"

# 2. Resolve each whitelist hostname to IPv4, pin to /etc/hosts so
#    subsequent lookups never need DNS, and collect IPs for iptables.
#    Done BEFORE the DROP policy goes in so the resolution itself
#    isn't blocked by the firewall we're about to install.
ALLOWED_IPS=()
for host in "${WHITELIST[@]}"; do
  mapfile -t ips < <(python3 - "$host" <<'PY'
import socket, sys
host = sys.argv[1]
try:
    res = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
except Exception:
    sys.exit(0)
for ip in {r[4][0] for r in res}:
    print(ip)
PY
  )
  for ip in "${ips[@]}"; do
    [[ -z "$ip" ]] && continue
    ALLOWED_IPS+=("$ip")
    echo "$ip $host" >> "$HOSTS"
  done
done

# Sanity: if we couldn't resolve ANY hostname, something is very
# wrong (no DNS, no internet, kernel rejected our resolver). Fail
# loudly so the relayer doesn't think a sandbox with broken egress
# is "working" — it would just hang, time out, and falsely report
# "tests timed out" for every PR.
if [[ ${#ALLOWED_IPS[@]} -eq 0 ]]; then
  echo "firewall: failed to resolve any whitelist host — refusing to start" >&2
  exit 1
fi

# 3. Apply iptables policy. Order matters: insert ACCEPT rules FIRST
#    (lo, established, DNS, whitelist), then flip the OUTPUT default
#    to DROP. This way we never have a window where the policy is
#    DROP but ACCEPTs aren't yet in place.
iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d "$DNS" -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -d "$DNS" -p tcp --dport 53 -j ACCEPT

# Dedupe IPs before adding rules — same CDN IP often serves multiple
# hostnames (CloudFront for npmjs + pypi files, GH Fastly for several
# github.com subdomains).
declare -A SEEN
for ip in "${ALLOWED_IPS[@]}"; do
  if [[ -z "${SEEN[$ip]:-}" ]]; then
    iptables -A OUTPUT -d "$ip" -p tcp --dport 443 -j ACCEPT
    iptables -A OUTPUT -d "$ip" -p tcp --dport 80 -j ACCEPT
    SEEN[$ip]=1
  fi
done

iptables -P OUTPUT DROP

# IPv6: Fly machines come with IPv6 connectivity. We don't allowlist
# any IPv6 destinations (the v4 set covers all the registries), so
# the cleanest move is to drop everything. ip6tables may be missing
# the conntrack module on some Fly kernels — best-effort with `|| true`
# so a fresh kernel that lacks v6 nat doesn't block boot.
ip6tables -F OUTPUT || true
ip6tables -A OUTPUT -o lo -j ACCEPT || true
ip6tables -P OUTPUT DROP || true

echo "firewall: egress restricted to ${#SEEN[@]} unique IPs across ${#WHITELIST[@]} hostnames" >&2
