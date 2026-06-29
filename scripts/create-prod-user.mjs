import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const email = 'sophia@df5holdings.com';
const password = 'DocEngage2026!';

console.log(`Creating user ${email} ...`);

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (error) {
  if (error.message.includes('already been registered')) {
    console.log('User already exists. Resetting password...');
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });
    const user = list.users.find(u => u.email === email);
    if (user) {
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password });
      if (updateErr) { console.error('Failed to reset:', updateErr.message); process.exit(1); }
      console.log('Password reset successfully.');
    }
  } else {
    console.error('Error:', error.message);
    process.exit(1);
  }
} else {
  console.log('Created user:', data.user.id);
}

console.log('\nLogin credentials:');
console.log('  Email:    sophia@df5holdings.com');
console.log('  Password: DocEngage2026!');
