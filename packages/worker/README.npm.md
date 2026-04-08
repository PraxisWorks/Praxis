# @praxwork/cli

CLI for running [Praxis](https://prax.work) AI sessions on your own machine.

## Install

```bash
npm install -g @praxwork/cli
```

## Setup

1. Log in at [prax.work](https://prax.work) and go to your **Profile** page
2. Click **Generate Worker Token**
3. Run the login command:

```bash
praxis login --token <token> --name 'My Laptop' --url https://app.prax.work
```

4. Start the worker:

```bash
praxis start
```

5. In the web app, select your worker from the **Active Worker** dropdown

All new AI sessions will now route to your local machine.

## Commands

| Command | Description |
|---------|-------------|
| `praxis login` | Authenticate and register a worker |
| `praxis start` | Start processing AI sessions |
| `praxis stop` | Gracefully stop the worker |
| `praxis status` | Show worker state and connection health |
| `praxis update` | Update to the latest version |
| `praxis logout` | Remove credentials and deregister |

## Updating

```bash
praxis update          # update and restart
praxis update --check  # check without installing
```

## Requirements

- Node.js 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated

## Links

- [Praxis](https://prax.work) - Web app
- [GitHub](https://github.com/PraxisWorks/Praxis) - Source code
- [Issues](https://github.com/PraxisWorks/Praxis/issues) - Bug reports

## License

[MIT](https://github.com/PraxisWorks/Praxis/blob/main/LICENSE)
