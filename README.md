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

``` bash
bun install
bun start
```
