#!/usr/bin/env python3
"""
Loads .env.local and runs npx prisma migrate dev --name init
using DIRECT_URL (port 5432) for the migration — NOT the pgbouncer pooler.
"""
import os
import re
import subprocess

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env.local')
env = dict(os.environ)

with open(env_path) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)="(.*)"$', line)
        if m:
            env[m.group(1)] = m.group(2)

# Migrations MUST use the direct (non-pooled) connection.
# Override DATABASE_URL with DIRECT_URL for the migrate command.
direct_url = env.get('DIRECT_URL', '')
if not direct_url:
    raise SystemExit('DIRECT_URL is not set in .env.local')

env['DATABASE_URL'] = direct_url

print(f"Using DIRECT_URL for migration: ...@{direct_url.split('@')[-1]}")
print()
print("Running: npx prisma migrate dev --name init")
print("-" * 60)

result = subprocess.run(
    ['npx', 'prisma', 'migrate', 'dev', '--name', 'init'],
    env=env,
    cwd=os.path.dirname(os.path.abspath(__file__)),
)

print("-" * 60)
print(f"Exit code: {result.returncode}")
