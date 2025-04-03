# demos-faucet

A faucet for the Demos Network

## Structure

### Server

The server is the backend of the Demos faucet.
It takes an `.env` file that defines the private key of the Demos wallet to be used by the frontend faucet and a couple of other options.

It is launched with

```bash
bun install
bun run src/index.ts
```

### Frontend (root folder)

The frontend needs to be configured with the `.env` file to call the right options on the right backend.

To run it, execute:

```bash
bun install
bun start
```

#### On webpack problems (like segfault)

**NOTE:** This is valid only for the frontend

On your local working environment, set everything (included .env) as it would be on the remote server or non working environment.

Then run:

```bash
bun run build
```

and commit/copy files in `dist/` to your non working environment.

Then, you can run:

```bash
bun run serve
```

To use the prebuilt files on production.
