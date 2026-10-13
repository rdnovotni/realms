#!/usr/bin/env python3
"""Read-only HTTPS probes: run outside the home network after approved DNS activation."""
import argparse,json,urllib.request,urllib.error

def probe(host,path):
 request=urllib.request.Request('https://'+host+path,headers={'Cache-Control':'no-cache','User-Agent':'Mozilla/5.0 (compatible; RealmsPublicVerification/1.0)'})
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(request,timeout=20) as result:return result.status,result.read(65536),result.geturl()
 except urllib.error.HTTPError as error:return error.code,error.read(65536),error.geturl()
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('hostname');args=ap.parse_args()
 import re
 if not re.fullmatch(r'[a-z0-9][a-z0-9.-]+\.[a-z]{2,63}',args.hostname):ap.error('Use a hostname only.')
 for path,expected in [('/health/live',200),('/api/v1/client/config',200),('/api/v1/state',401),('/admin',404),('/api/v1/admin',404),('/health/ready',404),('/metrics',404),('/.env',404),('/ws',404)]:
  status,body,url=probe(args.hostname,path)
  if status!=expected or url!='https://'+args.hostname+path:raise RuntimeError('Unexpected status/redirect for '+path)
  if path=='/health/live' and json.loads(body).get('service')!='realms-server':raise RuntimeError('Wrong backend')
  if path=='/api/v1/client/config' and json.loads(body).get('authMode')!='sessions':raise RuntimeError('Backend is not using session authentication')
  print('PASS:',path,status)
 print('HTTPS route checks passed. Check router IPv4 forwarding, IPv6 ingress and external port scans separately. No game WebSocket endpoint exists yet.')
if __name__=='__main__':
 try:main()
 except (OSError,ValueError,RuntimeError) as error:raise SystemExit('FAIL/UNKNOWN: '+str(error))
