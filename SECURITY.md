# SECURITY POLICY

## Supported Versions
CourseForge is under active development. Only the latest commit on the `main` branch is supported for security fixes. Older versions, forks, or custom deployments are not supported.

## Reporting a Vulnerability
If you discover a security issue, please report it privately.

Do not open a public GitHub issue.

Instead, email:

security@yourdomain.com

Your report should include:
- A clear description of the vulnerability
- Steps to reproduce
- Expected vs. actual behavior
- Any proof-of-concept code
- Potential impact if known

You will receive an acknowledgment within 72 hours.

## Responsible Disclosure
To protect users, please follow these rules:
- Do not publicly disclose the vulnerability until it has been fixed
- Do not test against production servers you do not own
- Do not attempt to access data you do not have permission to access
- Do not perform denial-of-service or load-testing attacks

Good-faith research is welcome, but destructive testing is not permitted.

## Scope
The following components are in scope:
- CourseForge backend (Firestore rules, cloud sync logic, auth flows)
- CourseForge desktop/CLI tools
- CourseForge agent workflows (GitHub Copilot, VS Code agents, MCP servers)
- Any official CourseForge documentation or scripts in this repository

The following are out of scope:
- Third-party services (Firebase, GitHub, Google, Microsoft, Apple, etc.)
- User-modified forks or deployments
- Issues caused by unsupported environments or custom patches

## Security Fix Process
Once a vulnerability is confirmed:
1. It is assigned a severity level (Low, Medium, High, Critical)
2. A fix is developed in a private branch
3. A patch release is published
4. A short disclosure summary is added to the changelog

Critical issues may result in a temporary freeze on new feature development.

## Preferred Research Areas
If you want to help improve CourseForge security, the most valuable areas are:
- Authentication flow and device inheritance logic
- Firestore security rules
- Cloud sync read/write minimization
- Abuse detection and rate-limiting
- Agent-to-agent communication integrity

## Hall of Thanks
Researchers who responsibly disclose vulnerabilities may be credited in the repository.
