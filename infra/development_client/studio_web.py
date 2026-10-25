#!/usr/bin/env python3
"""Loopback-only guided content workspace, launched from Development Studio."""
import argparse,json,secrets,threading,webbrowser
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from workspace import Workspace
import model
ASSETS=Path(__file__).parent/'web'
def make_server(workspace,port=0):
 token=secrets.token_urlsafe(32)
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*_):pass
  def send(self,status,data,kind='application/json'):
   value=json.dumps(data).encode() if kind=='application/json' else data
   self.send_response(status);self.send_header('Content-Type',kind+'; charset=utf-8');self.send_header('Content-Length',str(len(value)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");self.end_headers();self.wfile.write(value)
  def allowed(self,api=False,write=False):
   origin='http://127.0.0.1:'+str(self.server.server_port)
   if self.headers.get('Host')!=origin[7:]:self.send(403,{'error':'Loopback workspace host required.'});return False
   if self.headers.get('Origin') not in (None,origin) or (write and self.headers.get('Origin')!=origin):self.send(403,{'error':'Same-origin request required.'});return False
   if api and not secrets.compare_digest(self.headers.get('X-Studio-Token',''),token):self.send(403,{'error':'Workspace session required.'});return False
   return True
  def do_GET(self):
   path=urlsplit(self.path).path
   if not self.allowed(path.startswith('/api/')):return
   if path=='/':self.send(200,(ASSETS/'index.html').read_bytes().replace(b'__STUDIO_TOKEN__',token.encode()),'text/html')
   elif path in ('/app.js','/style.css'):self.send(200,(ASSETS/path[1:]).read_bytes(),'text/javascript' if path.endswith('.js') else 'text/css')
   elif path=='/api/state':self.send(200,workspace.request('read'))
   else:self.send(404,{'error':'Unknown workspace page.'})
  def do_POST(self):
   if not self.allowed(True,True):return
   if self.path!='/api/action':self.send(404,{'error':'Unknown action endpoint.'});return
   try:
    length=int(self.headers.get('Content-Length','0'))
    if not 0<length<=4*1024*1024 or self.headers.get_content_type()!='application/json':raise ValueError('A JSON request up to 4 MB is required.')
    data=json.loads(self.rfile.read(length),parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Finite JSON values required.')))
    operation=data.get('operation');result=workspace.request(operation,data.get('data'),data.get('expected'));self.send(200,result)
   except (ValueError,KeyError,TypeError) as e:self.send(400,{'error':str(e)[:2000]})
   except Exception:self.send(500,{'error':'Workspace action failed. The saved snapshot was retained; inspect the local tool output.'})
  def do_OPTIONS(self):self.send(403,{'error':'Cross-origin access is disabled.'})
 server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.daemon_threads=True;return server

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--workspace',type=Path,default=model.ROOT/'.development/studio-v0');parser.add_argument('--port',type=int,default=0);parser.add_argument('--demo',action='store_true');parser.add_argument('--open',action='store_true');args=parser.parse_args()
 if not 0<=args.port<=65535:parser.error('Invalid local port.')
 initial=json.loads((model.ROOT/'realms/test/fixtures/studio-demo.json').read_text()) if args.demo else None
 workspace=Workspace(args.workspace,initial=initial);server=make_server(workspace,args.port);url=f'http://127.0.0.1:{server.server_port}/';print(url,flush=True)
 if args.open:webbrowser.open(url)
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:server.server_close()
if __name__=='__main__':main()
