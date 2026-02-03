# Neon Database Migration - Netlify Setup Guide

## ✅ Neon Project Created
Your Neon database is ready at: `sweet-glade-77676337`

**Neon Connection String:**
```
postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require
```

## Set Environment Variables in Netlify

### Option 1: Using Netlify Web Dashboard (Recommended)

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Select your **QuantTrade AI** site
3. Navigate to **Site settings → Build & deploy → Environment**
4. Click **Add environment variable**
5. Add the following variables:

   | Variable Name | Value |
   |---|---|
   | `DATABASE_URL` | `postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require` |
   | `NEON_DATABASE_URL` | `postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require` |

6. Click **Save** for each variable
7. Redeploy your site (trigger a new build from **Deploys** tab)

### Option 2: Using Netlify CLI

```bash
netlify env:set DATABASE_URL "postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require"

netlify env:set NEON_DATABASE_URL "postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
```

## Schema Migration (if needed)

Your Neon database is currently empty. You can:

### Option A: Migrate Existing Data from Render (if you have data)
```bash
# Dump from Render
pg_dump "postgresql://finance_r6b5_user:DNNUZZVUJlIgWkSeRNJouFNt6Jo4boGX@dpg-d5jgvsvfte5s738ljoig-a.oregon-postgres.render.com/finance_r6b5" > dump.sql

# Restore to Neon
psql "postgresql+psycopg://neondb_owner:npg_XfjiwxFS27dT@ep-empty-feather-aekdevk0-pooler.c-2.us-east-2.aws.neon.tech/neondb" < dump.sql
```

### Option B: Create Fresh Tables
Run your database initialization scripts:
```bash
cd backend && python scripts/init_neon_database.py
```

## What Changed in Your Code

### `backend/app/config.py`
- ✅ Updated to prioritize `DATABASE_URL` from environment
- ✅ Falls back to `NEON_DATABASE_URL` if `DATABASE_URL` is not set
- ✅ Raises clear error if neither is configured

### `backend/.env` (Local Development)
- ✅ Updated to use Neon connection string
- ✅ Old Render URL preserved as comment for reference

## Next Steps

1. **Netlify Dashboard**: Set environment variables (Option 1 above)
2. **Redeploy**: Trigger a new build in Netlify
3. **Monitor**: Check deployment logs for database connection errors
4. **Verify**: Test your API endpoints to ensure they work with Neon

## Neon Features You Can Use

- **Branching**: Create development branches of your database
- **Autoscaling**: Automatically scales compute resources
- **Scale to Zero**: Pauses after inactivity (free tier)
- **Point-in-Time Recovery**: Restore to any point in the last 7 days

## References

- [Neon Documentation](https://neon.com/docs)
- [Neon with Netlify](https://neon.com/docs/guides/netlify)
- [Connection Pooling Guide](https://neon.com/docs/connect/connection-pooling)
