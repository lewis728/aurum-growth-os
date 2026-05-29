#!/usr/bin/env python3
"""
Updates DIRECT_URL in .env.local with the IPv4-compatible Supabase pooler URL.
URL-encodes special characters in the password.
Does not print or log the password.
"""
import re
import urllib.parse

env_path = '/home/ubuntu/aurum-growth-os/.env.local'

# New DIRECT_URL — password contains special chars that need URL-encoding
raw_password = 'sY2#sVvxq8MUe6& '
encoded_password = urllib.parse.quote(raw_password, safe='')
new_direct_url = (
    f'postgresql://postgres.zugbafsnhwntpzwdkqvd:{encoded_password}'
    f'@aws-0-eu-west-1.pooler.supabase.com:5432/postgres'
)

with open(env_path) as f:
    content = f.read()

content = re.sub(
    r'^DIRECT_URL=.*$',
    f'DIRECT_URL="{new_direct_url}"',
    content,
    flags=re.MULTILINE
)

with open(env_path, 'w') as f:
    f.write(content)

# Verify without printing password
host_part = new_direct_url.split('@')[-1]
print(f'DIRECT_URL updated. Host: {host_part}')
