#!/bin/bash
# Lists all auth users and checks for specific emails.
# Usage: bash scripts/check-users.sh

set -euo pipefail
source .env

echo "Fetching users from $VITE_SUPABASE_URL ..."
echo ""

curl -s "${VITE_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
users = data.get('users', data) if isinstance(data, dict) else data
if not users:
    print('No users found.')
    sys.exit()
print(f'Total users: {len(users)}')
print()
targets = ['sophia@df5holdings.com', 'sophia.df5holdings@gmail.com']
for u in users:
    email = u.get('email', '(no email)')
    uid = u.get('id', '?')
    created = u.get('created_at', '?')
    confirmed = 'yes' if u.get('email_confirmed_at') else 'no'
    marker = ' <-- MATCH' if email in targets else ''
    print(f'  {email}  id={uid}  created={created}  confirmed={confirmed}{marker}')
"
