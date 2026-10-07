# PrintFlow POS

PrintFlow POS is a browser-based point-of-sale and shop operations application for print shops. It is built with semantic HTML, responsive CSS, vanilla JavaScript, Supabase Auth, PostgreSQL, and PostgREST. There is no application server: authenticated browser sessions call Supabase directly, while privileged and multi-step operations are implemented as PostgreSQL RPC functions.

## Architecture

- `index.html` provides the sign-in and registration screens, the POS, bill history, management sub-tabs, and customer ledger views.
- `styles.css` contains the responsive interface, touch-friendly controls, loading animation, and modal styling.
- `app.js` initializes Supabase JS v2, loads the current account and operational data, and coordinates checkout and management actions.
- `supabase-schema.sql` creates the database objects, seed prices, RLS policies, and security-definer functions.
- Checkout runs through `public.create_bill(...)`. Bill header creation, item insertion, stock deduction, and customer balance updates occur in one PostgreSQL transaction. A failure rolls the entire operation back.

The POS supports photocopies, printouts, and configurable services in the `other` category. Customer debit balances are positive; customer credit balances are negative. Reports that expose all customer balances and statements are restricted to administrators.

## Supabase setup

1. Create a Supabase project and open **SQL Editor** in its dashboard.
2. Review `supabase-schema.sql`, update the seeded `super_admin_email` value to the shop owner's email, then run the complete script. It installs the `pgcrypto` dependency, role and service types, tables, triggers, seed data, RPCs, grants, and RLS policies, and asks PostgREST to reload its schema cache.
3. Check the SQL Editor output for errors before using the app. Running the script again is intended to be safe for the schema and seed data. Foreign-key constraints and RLS policies are explicitly refreshed by the script.
4. In **Authentication → URL Configuration**, set the production Site URL and add the local development and production URLs to the Redirect URLs allow list.
5. In **Authentication → Providers → Email**, enable email verification. Configure a working SMTP provider for production; Supabase's default email service is intended for limited testing. Users who verify their email still require an administrator's account approval before using the POS.
6. Create the owner account using the registration screen and the same email configured in `app_settings.super_admin_email`. The auth trigger assigns that account the protected `super_admin` role. Verify that its profile is approved before normal use.
7. In Supabase **Table Editor**, verify that the initial `Typesetting` service is present and configure the shop's service prices and A4/A5 inventory counts.

### Database and row-level security

The schema uses Supabase Auth as the identity provider and `public.profiles` for approved application roles. Row-level security is enabled for application data. Approved users may read their own bills and operational data; administrators can review approvals, stock requests, all bills, and the customer ledger. Browser roles cannot directly write bills or inventory: checkout, stock changes, cancellations, and sensitive team operations use authenticated RPC functions.

`public.create_bill` accepts bill items, customer details, payment amount, the credit preference, and (when a printout override is used) a PIN. It verifies the current service prices, keeps photocopy rates fixed to their database prices, stores the billed rates on each bill item, updates inventory, and applies the payment to the customer balance atomically. `public.search_customers` returns a limited matching set for POS autocomplete; it does not grant staff access to the full customer table. Customer balances and statements are directly readable only to administrators.

The profile foreign keys on `bills.billed_by` and `stock_requests.requested_by` are named explicitly so PostgREST joins can target the correct relationship. If the API still reports a missing relationship after applying the schema, check the SQL execution result and reload the Supabase project's API schema cache.

## Configuration

This is a static frontend. Supabase's project URL and **publishable/anon key** are browser-visible configuration, not secrets. In `app.js`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` near the top of the file to the values shown under **Project Settings → API**.

Never put a Supabase `service_role` key in this application or any client-delivered file. The anon key is safe to expose only with the supplied RLS policies enabled. If configuration is injected during a build instead of edited in `app.js`, use a deployment-time build step that writes only the public URL and publishable/anon key into the static bundle; do not treat frontend environment variables as secret.

For local development, serve the project files over HTTP (for example, `npx serve .`) and add that local URL to Supabase's Auth redirect allow list. Opening `index.html` directly with a `file:` URL is not a supported authentication workflow.

## Roles and access hierarchy

| Role | POS and own bills | Stock actions | Management | Customer ledger |
| --- | --- | --- | --- | --- |
| Staff | Create bills; view own bills; search customers for checkout | Submit stock requests | Not available | Not available |
| Admin | Staff access plus team, approval, stock, price, and bill management | Approve requests and add stock directly | Available | Full ledger and statements |
| Super Admin | Admin access plus role changes | Full access | Protected account; no UI action buttons | Full ledger and statements |

New accounts default to pending staff. Admin and super-admin protections are also enforced in database RPCs and RLS—not only by hiding controls in the interface. Admin-only actions such as deleting an account, changing a role, or resetting a staff PIN require a reason or PIN verification as applicable.

## Deploy to Vercel

1. Push the project files to a Git repository and import it in Vercel.
2. Keep the project as a static site: there is no build command or serverless function required. Set the output directory to the repository root (or leave the default if Vercel detects the static files).
3. Set the Supabase project URL and publishable/anon key in `app.js` before deployment. For a private repository, protect changes to these values through normal review; the anon key itself must not be used as an authorization boundary.
4. Add the Vercel production domain and any preview domains used for testing to Supabase's Auth redirect allow list. Set the production domain as the Supabase Site URL.
5. Deploy and test registration, email verification, owner sign-in, approval, POS checkout, inventory updates, bill history, and the customer ledger using real Supabase accounts.

Vercel preview deployments also need to be listed as Supabase redirect URLs if password reset or email confirmation is tested on those deployments. Do not use production customer data for preview testing unless the project is intentionally configured for that use.
