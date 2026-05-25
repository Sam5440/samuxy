# Contributing to samuxy

Thank you for your interest in contributing to samuxy. This repository contains the Windows-only Electron distribution.

## Humans Only Policy

samuxy is a community project and we want communication to stay between humans. **AI-generated text is not allowed** in:

- Issue descriptions and comments
- Pull request titles, descriptions, summaries, and comments
- Discussion replies and code review comments

You are welcome to use AI to help you write code, but the text you post on GitHub must be written by you, in your own words. Issues and PRs with AI-generated text will be closed without review.

## Getting Started

### Prerequisites

- Windows 10/11
- Node.js 22
- npm
- Git

### Setup

```powershell
git clone https://github.com/samuxy/samuxy.git
cd samuxy\electron
npm ci
npm run typecheck
```

### Running

From the repository root:

```powershell
.\start.ps1 -Mode dev -KillExisting
```

## Development Workflow

1. Fork the repository and create a branch from `main`
2. Make your changes
3. Run checks before committing
4. Push your branch and open a pull request

## Code Standards

- Early returns over nested conditionals
- Fix root causes, not symptoms
- Follow existing patterns, but suggest refactors if they improve quality
- Security first: no command injection, XSS, or other vulnerabilities

## Checks

Run the Windows check suite from the Electron package:

```powershell
cd electron
npm run ci:windows
```

This prepares the Windows icon, type-checks, runs Vitest, runs Playwright E2E tests, builds the app, and creates the Windows installer.

## Pull Request Guidelines

- Keep PRs focused on a single change
- Write a clear title and description explaining the "why"
- Ensure all checks pass before requesting review
- Link any related issues

## Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.yml) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.yml) template for ideas
- Search existing issues before creating a new one

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
