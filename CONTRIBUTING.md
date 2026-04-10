# Contributing to QuantTrade-AI

This repository is configured for **pull requests into `main`**, **Code Scanning**, and **verified commits**. Follow the sections below so your changes match those rules.

## 1. Work via pull requests (not direct pushes to `main`)

**Typical flow**

```bash
git fetch origin
git checkout main
git pull origin main

git checkout -b feature/short-description-of-change
# make commits (signed — see §3)
git push -u origin feature/short-description-of-change
```

Then on GitHub: **Compare & pull request** → target branch **`main`** → get review (if required) → merge.

**Optional: tighten rules so even admins cannot bypass**

On GitHub: **Settings → Rules → Rulesets** (or **Branches → Branch protection rules** for `main`):

- Require a pull request before merging.
- Optionally disallow bypass for administrators if you want the rules to always apply.

## 2. Code Scanning (CodeQL)

This repo includes [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml). It runs on pushes and PRs to `main` and uploads results to GitHub.

**After the workflow has run at least once**

1. Open the repo on GitHub.
2. Go to **Security** → **Code scanning**.
3. Open any findings and fix or dismiss with a reason.

**If alerts do not appear**

- **Settings → Code security and analysis** → enable **Code scanning** (and **Default setup** or confirm advanced setup is allowed).
- Check **Actions** for failed **CodeQL** workflow runs and fix workflow errors.

## 3. Verified (signed) commits

Branch protection may require **commits to have verified signatures**. Sign commits locally, then add the matching key to GitHub.

### Option A — SSH signing (simple on macOS)

1. Use an SSH key you already use for GitHub, or create one:

   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com" -f ~/.ssh/id_ed25519_signing
   ```

2. Add the **public** key in GitHub: **Settings → SSH and GPG keys → New SSH key** → type **Signing key** → paste `~/.ssh/id_ed25519_signing.pub`.

3. Configure Git:

   ```bash
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/id_ed25519_signing.pub
   git config --global commit.gpgsign true
   ```

4. New commits will show as **Verified** after you push (for that key).

To sign **one** commit without changing global config:

```bash
git commit -S -m "Your message"
```

### Option B — GPG signing

1. Install GnuPG, generate a key, and add the public key to GitHub under **SSH and GPG keys** as a **GPG key**.
2. Set signing key and enable signing:

   ```bash
   git config --global user.signingkey YOUR_GPG_KEY_ID
   git config --global commit.gpgsign true
   ```

Use GitHub’s docs for details: [Signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

### Re-sign the last commit (if you forgot to sign)

```bash
git commit --amend -S --no-edit
```

(Only do this on commits you have not pushed yet, or coordinate with anyone who already pulled the old commit.)

## Quick checklist

| Goal             | Action                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Match “PRs only” | Push feature branches; open PRs into `main`.                                                                  |
| Code Scanning    | Merge `codeql.yml`; enable scanning under **Code security and analysis**; check **Security → Code scanning**. |
| Verified commits | `commit.gpgsign true` + SSH or GPG key registered on GitHub as signing key.                                   |

Questions about repo-specific conventions can go into an issue or the PR description.
