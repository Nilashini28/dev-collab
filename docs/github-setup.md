# GitHub Contributions setup

Public repository connections now work without API keys or Redis. Open a project → Contributions → Public repository, enter `owner/repository`, then connect. Manual sync runs through the API and shows its real result. GitHub network access and public API limits still apply.

Private repositories require an approved GitHub App installation; manual sync also works through the API once configured. A Redis worker is needed for automatic webhook dispatch and reconciliation.

See [GitHub and AI setup](github-ai-setup.md) for environment variables, GitHub App permissions, installation approval, AI assistant configuration, verification, and troubleshooting.
