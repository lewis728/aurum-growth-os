#!/usr/bin/env python3
"""
Tests direct PostgreSQL connection to Supabase using psycopg2.
Does not print the password.
"""
import re
import sys

env_path = '/home/ubuntu/aurum-growth-os/.env.local'

env = {}
with open(env_path) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)="(.*)"$', line)
        if m:
            env[m.group(1)] = m.group(2)

direct_url = env.get('DIRECT_URL', '')
if not direct_url:
    sys.exit('DIRECT_URL not found')

host_part = direct_url.split('@')[-1]
print(f'Testing connection to: {host_part}')

try:
    import psycopg2
    conn = psycopg2.connect(direct_url)
    cur = conn.cursor()
    cur.execute('SELECT version();')
    row = cur.fetchone()
    print(f'Connected! PostgreSQL version: {row[0][:50]}')
    conn.close()
except ImportError:
    print('psycopg2 not installed — skipping direct test')
except Exception as e:
    # Print error type and message but not the URL
    print(f'Connection failed: {type(e).__name__}: {str(e)[:200]}')
