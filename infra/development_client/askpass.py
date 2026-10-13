#!/usr/bin/python3
"""Git asks for credentials; never log or persist the session token."""
import os,sys
print('rdnovotni' if 'username' in ' '.join(sys.argv[1:]).lower() else os.environ.get('REALMS_STUDIO_GITHUB_TOKEN',''))
