#!/usr/bin/env python3
"""Run the real release verification path for one Git checkpoint without staging or deployment."""
import argparse,importlib.util,json,subprocess,tempfile,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def load(name,file):
 s=importlib.util.spec_from_file_location(name,ROOT/'infra/scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source-commit');args=parser.parse_args()
 commit=args.source_commit or subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
 snapshot=load('checkpoint_snapshot','git_snapshot.py');verification=load('checkpoint_verification','release_verification.py');postgres=load('checkpoint_postgres','postgresql.py')
 with tempfile.TemporaryDirectory(prefix='realms-checkpoint-') as directory:
  snapshot.freeze(commit,directory,ROOT)
  receipt=verification.verify_checkpoint(Path(directory),commit,'verify-'+uuid.uuid4().hex,postgres.p,postgres.inspect)
 print(json.dumps(receipt,indent=2))
if __name__=='__main__':main()
