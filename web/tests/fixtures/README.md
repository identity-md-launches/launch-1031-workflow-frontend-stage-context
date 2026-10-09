# Public contract fixture

`floor-relay-runtime.hex` is the public Ethereum bytecode read from FloorRelay `0x1ff0fb56f9a6c5c5c8201906d487ec4d8f5afc50` using `eth_getCode` on 2026-10-09. Its Keccak-256 is the runtime hash in `web/src/floor-relay.json`. It is used only by deterministic browser RPC fixtures so deployment checks exercise the same relay identity check as production. It contains no private key or credentials.
