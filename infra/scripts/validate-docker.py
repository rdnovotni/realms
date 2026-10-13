#!/usr/bin/env python3
"""Real Engine acceptance checks. Creates/reuses only the two infra-test projects."""
import argparse,fcntl,importlib.util,json,os,socket,subprocess,threading,time,urllib.request
from pathlib import Path
spec=importlib.util.spec_from_file_location('projects',Path(__file__).with_name('docker-projects.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
D=p.DOCKER

def output(args): return subprocess.check_output(args,text=True).strip()
def inspect(kind,name): return json.loads(output(D+[kind,'inspect',name]))[0]
def container(name): return output(D+['compose','--project-directory',str(p.BASE/name),'--env-file',str(p.BASE/name/'.env'),'-f',str(p.BASE/name/'compose.yaml'),'ps','-q','web'])
def check(ok,description):
    if not ok: raise RuntimeError(description)
    print('PASS:',description,flush=True)
def fetch(port):
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{port}/project.txt',timeout=5) as r: return r.read().decode().strip()
def seed(name):
    volume=f'{name}_data'
    label=inspect('volume',volume)['Labels'] or {}
    check(label.get('com.docker.compose.project')==name,'seed volume belongs to '+name)
    p.run(D+['run','--rm','--network','none','--memory','64m','--cpus','0.25','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
             '-v',f'{volume}:/data','python:3.13-alpine','python','-c',
             'from pathlib import Path; import sys; Path("/data/project.txt").write_text(sys.argv[1]+chr(10))',name])
def remote_probe(network,gateway,targets):
    # Positive control: temporary listener on the probe bridge's host-only gateway.
    # This proves the probe can reach host TCP services; not a public LAN listener.
    listener=socket.socket();listener.bind((gateway,0));listener.listen(4)
    control=listener.getsockname()[1]
    def accept():
        listener.settimeout(15)
        try:
            conn,_=listener.accept();conn.close()
        except OSError: pass
    worker=threading.Thread(target=accept,daemon=True);worker.start()
    code='''import json,socket,sys
checks=json.loads(sys.argv[1]); result=[]
for host,port in checks:
 try:
  s=socket.create_connection((host,port),timeout=2);s.close(); result.append(True)
 except OSError: result.append(False)
print(json.dumps(result))'''
    try:
        results=json.loads(output(D+['run','--rm','--network',network,'--memory','64m','--cpus','0.25','--pids-limit','32','--read-only','--user','65534:65534','--cap-drop','ALL','--security-opt','no-new-privileges:true',
            'python:3.13-alpine','python','-c',code,json.dumps([(gateway,control)]+targets)]))
        check(results[0],'independent probe reaches host gateway positive control')
        for target,reached in zip(targets,results[1:]): check(not reached,f'independent bridge cannot reach {target[0]}:{target[1]}')
    finally: listener.close();worker.join(timeout=1)
def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--after-reboot',action='store_true');args=ap.parse_args()
    if os.geteuid()!=0: ap.error('Run with sudo to inspect the local Docker socket.')
    lockdir=Path('/run/lock/kol-docker');lockdir.mkdir(exist_ok=True,mode=0o700)
    lock=(lockdir/'operations.lock').open('a')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError('Another Docker infrastructure operation is running.')
    output(D+['info']);output(D+['compose','version'])
    for unit in ['docker.service','containerd.service']:
        check(output(['systemctl','is-active',unit])=='active',unit+' active')
        check(output(['systemctl','is-enabled',unit])=='enabled',unit+' enabled')
    state=p.STATE_BASE/'infra-004';state.mkdir(parents=True,exist_ok=True,mode=0o700)
    before={u:output(['systemctl','is-active',u]) for u in ['kol-realms.service','kol-postgresql.service','libvirtd.service']}
    baseline=state/'acceptance.json';boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if args.after_reboot:
        previous=json.loads(baseline.read_text())
        check(previous['boot']!=boot,'actual reboot occurred since initial acceptance')
        # Do not start anything: inspect recovery exactly as found after boot.
    else:
        p.init()
        for name in ['infra-test-a','infra-test-b']:
            p.compose(name,'up','-d','--wait','--wait-timeout','120');seed(name)
    ids={n:container(n) for n in ['infra-test-a','infra-test-b']}
    nets=[];vols=[];targets=[]
    addresses=json.loads(output(['ip','-j','address','show']))
    host_ips=[a['local'] for iface in addresses for a in iface.get('addr_info',[]) if a.get('scope')=='global' and iface['ifname'] not in ['lo','docker0'] and not iface['ifname'].startswith(('br-','veth','virbr'))]
    check(bool(host_ips),'at least one LAN/global address available for exposure tests')
    for name,port in [('infra-test-a',18081),('infra-test-b',18082)]:
        c=inspect('container',ids[name]);check(c['State']['Running'],name+' running')
        check(c['HostConfig']['RestartPolicy']['Name']=='unless-stopped',name+' restart policy')
        check(c['HostConfig']['Memory']==96*1024*1024,name+' memory cap')
        bindings=c['HostConfig']['PortBindings'];check(bindings=={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':str(port)}]},name+' only explicit IPv4 loopback port')
        netnames=list(c['NetworkSettings']['Networks']);check(set(netnames)=={name+'_private',name+'_frontend'},name+' separate private and frontend networks')
        for netname in netnames:
            net=inspect('network',netname)
            check(bool(net['Internal'])==(netname==name+'_private'),name+' correct isolation: '+netname.rsplit('_',1)[-1])
            nets.append(net['Id'])
            if net['Internal']:
                ip=c['NetworkSettings']['Networks'][netname]['IPAddress'];targets.append((ip,8080))
        published=c['NetworkSettings']['Ports'].get('8080/tcp')
        check(published==[{'HostIp':'127.0.0.1','HostPort':str(port)}],name+' port publication actually programmed')
        mounts=[m['Name'] for m in c['Mounts'] if m['Type']=='volume'];check(len(mounts)==1,name+' one volume');vols+=mounts
        check(fetch(port)==name,name+' HTTP and persistent volume identity')
        for addr in host_ips:
            try:
                connection=socket.create_connection((addr,port),timeout=2);connection.close();reached=True
            except OSError: reached=False
            check(not reached,name+' not reachable through non-loopback host address')
            if ':' not in addr: targets.append((addr,port))
    check(len(set(nets))==4,'projects have different private and frontend network IDs');check(len(set(vols))==2,'projects have different volumes')
    old=inspect('container',ids['infra-test-b'])['State']['StartedAt']
    if not args.after_reboot:
        p.compose('infra-test-a','restart','web')
        for _ in range(30):
            try:
                if fetch(18081)=='infra-test-a': break
            except OSError: pass
            time.sleep(1)
        check(fetch(18081)=='infra-test-a','restarted project healthy with data retained')
        check(container('infra-test-b')==ids['infra-test-b'] and inspect('container',ids['infra-test-b'])['State']['StartedAt']==old,'restarting A leaves B running without restart')
        check(fetch(18082)=='infra-test-b','B remains available')
    probe='kol-infra-004-probe'
    # Refuse to delete or reuse any pre-existing network with this name.
    p.run(D+['network','create','--label','kol.infra.ticket=004',probe],stdout=subprocess.DEVNULL)
    try:
        n=inspect('network',probe);gateway=n['IPAM']['Config'][0]['Gateway'];remote_probe(probe,gateway,targets)
    finally: p.run(D+['network','rm',probe],stdout=subprocess.DEVNULL)
    for unit,status in before.items(): check(output(['systemctl','is-active',unit])==status and status=='active','existing workload preserved: '+unit)
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:3000/health/ready',timeout=5) as r:
        check(r.status==200,'native game readiness still healthy')
    if not args.after_reboot:
        baseline.write_text(json.dumps({'boot':boot,'containers':ids,'volumes':vols,'networks':nets},indent=2)+'\n');os.chmod(baseline,0o600)
        print('Initial acceptance passed; test projects remain running for reboot verification.')
    else:
        check(previous['containers']==ids,'same containers recovered after reboot')
        check(previous['volumes']==vols and previous['networks']==nets,'networks and persistent volumes survived reboot')
        print('Docker reboot acceptance passed. Still verify desktop/VM workload health manually.')
if __name__=='__main__':
    try: main()
    except (subprocess.CalledProcessError,RuntimeError,OSError,ValueError) as e: raise SystemExit('FAIL/UNKNOWN: '+str(e))
