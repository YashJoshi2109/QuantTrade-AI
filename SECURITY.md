# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ Active |
| Older branches | ❌ No patches |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's [Private Vulnerability Reporting](https://github.com/YashJoshi2109/QuantTrade-AI/security/advisories/new) — it keeps the disclosure private until a fix is released.

Include in your report:

- Description of the vulnerability and its impact
- Steps to reproduce or proof-of-concept
- Affected component (frontend, backend API, ML pipeline, infra)
- Suggested severity (Critical / High / Medium / Low)

## Response Timeline

| Stage | Target |
|-------|--------|
| Acknowledgement | 48 hours |
| Severity assessment | 5 business days |
| Fix for Critical/High | 14 days |
| Fix for Medium/Low | 30 days |
| Public disclosure | After fix is deployed |

## Scope

**In scope:**

- Authentication & authorization (JWT, passkey, OAuth)
- API endpoints (`/api/v1/*`, `/api/v1/internal/*`)
- ML pipeline and model artifact integrity
- Infrastructure (Lambda, EC2, CloudFormation)
- Dependency vulnerabilities in `requirements*.txt` or `package.json`
- Secret/credential exposure in code or logs

**Out of scope:**

- Vulnerabilities requiring physical access
- Social engineering attacks
- Findings from automated scanners with no proof of exploitability
- Rate limiting on public read-only endpoints

## Security Controls

- **Auth**: ECDSA P-256 JWT (AWS KMS), WebAuthn/Passkey, OAuth 2.0
- **Secrets**: GitHub Secrets + AWS Secrets Manager; no secrets in code
- **Dependencies**: Dependabot alerts enabled; CodeQL scanning on every push
- **ML artifacts**: S3 upload with IAM least-privilege; CF KV writes require signed token
- **SSRF defense**: Allowlist on all URL-fetch paths; internal endpoints require `X-ML-Callback-Secret`

## Contact

Email: yashjosh7486@gmail.com (PGP not required for initial contact)
