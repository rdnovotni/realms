#!/usr/bin/env python3
"""Read-only, limited TCP probes of your own home origin from an outside network."""
import argparse,concurrent.futures,ipaddress,json,socket,urllib.request
PORTS=(22,80,443,3000,13000,13001,5432,55432,6379,19080,19081,19091,61208,8123,9090)
def probe(address,port):
 with socket.socket(socket.AF_INET6 if ':' in address else socket.AF_INET,socket.SOCK_STREAM) as sock:
  sock.settimeout(2)
  try:return {'port':port,'reachable':sock.connect_ex((address,port))==0}
  except OSError:return {'port':port,'reachable':False}
def connectivity_control():
 req=urllib.request.Request('https://playfollybound.com/health/live',headers={'User-Agent':'Mozilla/5.0 (compatible; RealmsOriginVerification/1.0)'})
 with urllib.request.urlopen(req,timeout=10) as response:
  if response.status!=200 or json.loads(response.read(8192)).get('service')!='realms-server':raise RuntimeError('Outside-client Internet positive control failed')

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('origin_ip');p.add_argument('--outside-network',action='store_true');p.add_argument('--owned-origin',action='store_true');a=p.parse_args()
 if not a.outside_network or not a.owned_origin:p.error('Run outside the home LAN against your own origin; both confirmation flags are required')
 address=ipaddress.ip_address(a.origin_ip)
 if not address.is_global or address.is_multicast:p.error('Use the actual router WAN IPv4 or server global IPv6, not a private/LAN address or Cloudflare address')
 connectivity_control()
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:rows=list(pool.map(lambda port:probe(str(address),port),PORTS))
 print(json.dumps({'family':address.version,'ports':rows,'scope':'Specified TCP ports only; this does not establish UDP, all-port or future policy safety'},indent=2))
 if any(r['reachable'] for r in rows):raise SystemExit('Review reachable origin services before declaring exposure acceptance passed')
 print('PASS: tested origin TCP ports were not reachable from this client')
if __name__=='__main__':
 try:main()
 except (OSError,ValueError,RuntimeError):raise SystemExit('FAIL/UNKNOWN: outside-client connectivity or probe unavailable; no exposure acceptance established')
