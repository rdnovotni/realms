#!/usr/bin/env bash
set -euo pipefail
mode=${1:-plan}
[[ $# -le 1 && "$mode" =~ ^(plan|apply|adopt)$ ]] || { echo 'Usage: sudo bash scripts/install-docker.sh [plan|apply|adopt]'; exit 2; }
source /etc/os-release
[[ $ID == ubuntu && ${UBUNTU_CODENAME:-$VERSION_CODENAME} =~ ^(jammy|noble|resolute)$ ]] || { echo 'Unsupported Ubuntu release; stopping.'; exit 1; }
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
printf 'Ubuntu %s; architecture %s\n' "$VERSION_ID" "$(dpkg --print-architecture)"
free -h
df -h / /srv
for package in docker-ce docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman podman-docker containerd runc containerd.io; do
  dpkg-query -W -f='${binary:Package}: ${Status}\n' "$package" 2>/dev/null || true
done
systemctl show docker.service containerd.service -p Id -p LoadState -p ActiveState || true
if [[ $mode == plan ]]; then
  echo 'Plan: install official Engine/Compose if absent; refuse runtime conflicts or existing data/config; retain native services.'
  echo 'Docker creates bridge/NAT/firewall rules and enables forwarding. Existing LAN bridge and libvirt must be checked after installation.'
  echo 'No users are added to the root-equivalent docker group. Projects will be staged under /srv/kol-infra/projects.'
  exit 0
fi
[[ $EUID == 0 ]] || { echo 'Run apply/adopt with sudo in your desktop terminal.'; exit 1; }
[[ $(ps -p 1 -o comm=) == systemd ]] || { echo 'Requires a booted systemd host.'; exit 1; }
if [[ $mode == adopt ]]; then
  docker --host unix:///var/run/docker.sock info >/dev/null
  docker --host unix:///var/run/docker.sock compose version
  systemctl enable docker.service containerd.service
  echo 'Existing daemon adopted without restarting or changing its configuration. Per-project policies remain required.'
  exit 0
fi
for package in docker-ce docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc containerd.io; do
  if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]]; then
    echo "Existing/conflicting package $package: inspect first; use adopt for a working Docker installation. Nothing removed."; exit 1
  fi
done
for path in /etc/docker/daemon.json /var/lib/docker /var/lib/containerd /run/docker.sock /run/containerd/containerd.sock /etc/apt/keyrings/docker.asc /etc/apt/sources.list.d/docker.sources; do
  [[ ! -e $path ]] || { echo "Existing $path; stopping to preserve configuration/data. Inspect before adoption or recovery."; exit 1; }
done
if python3 - <<'PY_REPO'
from pathlib import Path
files=[Path('/etc/apt/sources.list'),*Path('/etc/apt/sources.list.d').glob('*')]
raise SystemExit(0 if any(p.is_file() and 'download.docker.com' in p.read_text() for p in files) else 1)
PY_REPO
then
  echo 'An existing Docker package source needs inspection; stopping.'; exit 1
fi
if pgrep -x 'dockerd|containerd|podman' >/dev/null; then echo 'Existing runtime process; stopping.'; exit 1; fi
snapshot=$(mktemp -d /var/lib/kol-docker-install.XXXXXXXX)
chmod 700 "$snapshot"
ip -j route show table all > "$snapshot/routes.json"
ip -j address show > "$snapshot/addresses.json"
systemctl show kol-realms.service kol-postgresql.service libvirtd.service -p Id -p ActiveState > "$snapshot/services.before"
command -v iptables-save >/dev/null && iptables-save > "$snapshot/iptables.before" || true
sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding > "$snapshot/forwarding.before"
python3 - "$snapshot" <<'PY'
import ipaddress,json,sys
from pathlib import Path
s=Path(sys.argv[1]); networks=[]
for route in json.loads((s/'routes.json').read_text()):
    dst=route.get('dst','default')
    if dst!='default':
        try: networks.append(ipaddress.ip_network(dst,strict=False))
        except ValueError: pass
for interface in json.loads((s/'addresses.json').read_text()):
    for a in interface.get('addr_info',[]):
        if a['family']=='inet': networks.append(ipaddress.ip_network(f"{a['local']}/{a['prefixlen']}",strict=False))
for base in ['172.28.0.0/16','172.29.0.0/16','10.240.0.0/16','10.241.0.0/16']:
    candidate=ipaddress.ip_network(base)
    if not any(candidate.overlaps(n) for n in networks if n.version==4): break
else: raise SystemExit('No non-overlapping Docker address pool; stop and plan networking.')
upper=list(candidate.subnets(new_prefix=17))[1]
config={'log-driver':'local','log-opts':{'max-size':'10m','max-file':'3'},'live-restore':True,'ip-forward-no-drop':True,
        'bip':f'{candidate.network_address+1}/24','default-address-pools':[{'base':str(upper),'size':24}]}
(s/'daemon.json').write_text(json.dumps(config,indent=2)+'\n')
PY
install -d -m 755 /etc/docker /etc/apt/keyrings
install -m 644 "$snapshot/daemon.json" /etc/docker/daemon.json
export NEEDRESTART_MODE=l
apt-get update
apt-get --no-remove install -y ca-certificates curl
curl --proto '=https' --tlsv1.2 -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$snapshot/docker.asc"
install -m 644 "$snapshot/docker.asc" /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<SOURCE
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
SOURCE
apt-get update
apt-get --no-remove install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
dockerd --validate --config-file=/etc/docker/daemon.json
systemctl enable --now docker.service containerd.service
docker --host unix:///var/run/docker.sock info >/dev/null
docker --host unix:///var/run/docker.sock compose version
systemctl show kol-realms.service kol-postgresql.service libvirtd.service -p Id -p ActiveState > "$snapshot/services.after"
if ! diff -u "$snapshot/services.before" "$snapshot/services.after"; then
  echo 'Existing workload service state changed: inspect before proceeding.'; exit 1
fi
printf 'Installed. Private installation record: %s\n' "$snapshot"
echo 'Next: sudo python3 scripts/docker-projects.py init'
echo 'No reboot, native service migration, group membership, or existing firewall policy reset performed.'
