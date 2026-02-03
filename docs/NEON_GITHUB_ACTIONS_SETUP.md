# Neon GitHub Actions Setup Guide

## Automated Database Branching for Pull Requests

This workflow automatically creates a separate Neon database branch for each pull request and deletes it when the PR is closed.

### ✅ What's Set Up

A GitHub Actions workflow (`.github/workflows/neon-branch.yml`) that:
- **Creates** a preview database branch when PR is opened/reopened/synchronized
- **Expires** the preview branch after 14 days
- **Deletes** the preview branch when PR is closed
- Naming convention: `preview/pr-{PR_NUMBER}-{BRANCH_NAME}`

### 📋 Setup Steps

You need to add 2 items to GitHub repository settings:

#### 1. Add `NEON_PROJECT_ID` Variable

1. Go to GitHub: **Settings → Secrets and variables → Variables**
2. Click **New repository variable**
3. Name: `NEON_PROJECT_ID`
4. Value: `sweet-glade-77676337`
5. Click **Add variable**

#### 2. Add `NEON_API_KEY` Secret

1. Go to GitHub: **Settings → Secrets and variables → Secrets**
2. Click **New repository secret**
3. Name: `NEON_API_KEY`
4. Value: `napi_wdwx81s6z608b699wnrw9svcfel0t1jw01jwnv6c6gclx9gwp0f4chhikxghfa6n`
5. Click **Add secret**

⚠️ **Important:** The API key is sensitive. Never commit it to the repository.

### 🚀 How It Works

When you create a PR:
1. GitHub Actions workflow triggers automatically
2. Creates a new Neon database branch: `preview/pr-123-feature-name`
3. You can run migrations on this branch (optional - see below)
4. When PR is closed, the preview branch is automatically deleted

### 🔄 Optional: Run Migrations on Preview Branch

To automatically run database migrations on the preview branch, uncomment this section in `.github/workflows/neon-branch.yml`:

```yaml
- name: Run Migrations
  run: npm run db:migrate
  env:
    DATABASE_URL: "${{ steps.create_neon_branch.outputs.db_url_with_pooler }}"
```

For Python/FastAPI, you could run:
```yaml
- name: Run Migrations
  run: python scripts/init_neon_database.py
  env:
    DATABASE_URL: "${{ steps.create_neon_branch.outputs.db_url_with_pooler }}"
```

### 📊 Optional: Post Schema Diff to PR

To automatically post schema changes in PR comments, uncomment this section:

```yaml
- name: Post Schema Diff Comment to PR
  uses: neondatabase/schema-diff-action@v1
  with:
    project_id: ${{ vars.NEON_PROJECT_ID }}
    compare_branch: preview/pr-${{ github.event.number }}-${{ needs.setup.outputs.branch }}
    api_key: ${{ secrets.NEON_API_KEY }}
```

### ✅ Verify Setup

1. Create a test PR
2. Go to **Actions** tab in GitHub
3. Look for "Create/Delete Neon Branch for Pull Request" workflow
4. You should see a successful run with:
   - ✅ Setup job
   - ✅ Create Neon Branch job
5. Check Neon Console for the new preview branch: `preview/pr-{NUMBER}-{BRANCH_NAME}`

### 🔗 Useful Links

- [Neon Create Branch Action](https://github.com/neondatabase/create-branch-action)
- [Neon Schema Diff Action](https://github.com/neondatabase/schema-diff-action)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Neon Branching Guide](https://neon.com/docs/guides/branching-guide)

### Troubleshooting

**Workflow not running:**
- Check that `NEON_PROJECT_ID` and `NEON_API_KEY` are set correctly
- Verify variable/secret names match exactly (case-sensitive)
- Check **Actions** tab for error messages

**Branch not created:**
- Check the workflow run logs for API errors
- Verify Neon project ID is correct
- Ensure API key has permissions to create branches

**Schema issues on preview branch:**
- Enable the migration step in the workflow
- Ensure your migration scripts work with the preview branch connection string
