#!/bin/bash
# Resets password for the production login user.
# Usage: bash scripts/create-prod-user.sh

set -euo pipefail
source .env

echo "Looking up sophia@df5holdings.com on $VITE_SUPABASE_URL ..."

# First, list users to find the existing account
USER_ID=$(curl -s "${VITE_SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
users = data.get('users', data) if isinstance(data, dict) else data
for u in users:
    if u.get('email') == 'sophia@df5holdings.com':
        print(u['id'])
        break
else:
    print('NOT_FOUND')
")

if [ "$USER_ID" = "NOT_FOUND" ]; then
  echo "No existing account found. Creating new user..."
  curl -s -X POST "${VITE_SUPABASE_URL}/auth/v1/admin/users" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"email":"sophia@df5holdings.com","password":"DocEngage2026!","email_confirm":true}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created — user id:', d.get('id', d.get('msg', d)))"
else
  echo "Found existing account: $USER_ID"
  echo "Resetting password..."
  curl -s -X PUT "${VITE_SUPABASE_URL}/auth/v1/admin/users/${USER_ID}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"password":"DocEngage2026!"}' \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK — password reset for:', d.get('email', d.get('msg', d)))"
fi

echo ""
echo "Login credentials:"
echo "  Email:    sophia@df5holdings.com"
echo "  Password: DocEngage2026!"
