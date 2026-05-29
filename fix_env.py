#!/usr/bin/env python3
"""
Fixes the DATABASE_URL and DIRECT_URL in .env.local by URL-encoding
the space character in the password (& -> %26, space -> %20).
"""
import re

env_path = '/home/ubuntu/aurum-growth-os/.env.local'

with open(env_path) as f:
    content = f.read()

# The password is: sY2#sVvxq8MUe6& (with a trailing space before @)
# URL-encode the space as %20 and & as %26 in the password portion
# Pattern: postgresql://postgres:PASSWORD@host
def fix_url(url: str) -> str:
    # Extract and fix the password portion between : and @
    # Password: sY2#sVvxq8MUe6& (space)
    # Encoded:  sY2%23sVvxq8MUe6%26%20
    # The # must also be encoded as %23, & as %26, space as %20
    url = url.replace('sY2#sVvxq8MUe6& @', 'sY2%23sVvxq8MUe6%26%20@')
    return url

lines = content.split('\n')
new_lines = []
for line in lines:
    if line.startswith('DATABASE_URL=') or line.startswith('DIRECT_URL='):
        # Extract the URL value
        m = re.match(r'^([A-Z_]+)="(.*)"$', line)
        if m:
            key = m.group(1)
            val = m.group(2)
            fixed = fix_url(val)
            new_lines.append(f'{key}="{fixed}"')
            print(f'Fixed {key}: ...{fixed[fixed.find("@"):fixed.find("@")+40]}')
            continue
    new_lines.append(line)

with open(env_path, 'w') as f:
    f.write('\n'.join(new_lines))

print('Done.')
